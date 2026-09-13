import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_ANIM_FRAME_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_THUMB_BYTES,
} from './uploads/limits'

// DB (imageStore) と sharp を掴む変換 (normalizeImage・thumbnail・videoAnim)、
// moov の詰め替え (mp4Faststart) は差し替える。確かめたいのは storeAttachment の
// 振り分け — どの判定がどの順で効き、何を保存に回し、何を返すか — であって、
// Postgres や sharp ではない (lib/zip/importZip.test.ts と同じ流儀)。
// 形式の判定 (uploads/sniff) とテキストの正規化 (normalizeText) は本物を通す
const saveImage = vi.fn<(...args: unknown[]) => Promise<string>>()
const savePlainAttachment = vi.fn<(...args: unknown[]) => Promise<string>>()
const normalizeImage = vi.fn<(bytes: Uint8Array, format: string) => Promise<unknown>>()
const makeThumbnail = vi.fn<(bytes: Uint8Array, label?: string) => Promise<Uint8Array | null>>()
const makeVideoAnim = vi.fn<(frames: Uint8Array[], label?: string) => Promise<Uint8Array | null>>()
const moveMoovToFront = vi.fn<(bytes: Uint8Array) => Uint8Array | null>()

vi.mock('@/lib/imageStore', () => ({
  saveImage: (...args: unknown[]) => saveImage(...args),
  savePlainAttachment: (...args: unknown[]) => savePlainAttachment(...args),
  restoreAttachmentRow: vi.fn(),
}))

vi.mock('@/lib/normalizeImage', () => ({
  normalizeImage: (bytes: Uint8Array, format: string) => normalizeImage(bytes, format),
}))

vi.mock('@/lib/thumbnail', () => ({
  makeThumbnail: (...args: [Uint8Array, string?]) => makeThumbnail(...args),
}))

vi.mock('@/lib/video/videoAnim', () => ({
  makeVideoAnim: (...args: [Uint8Array[], string?]) => makeVideoAnim(...args),
}))

vi.mock('@/lib/mp4Faststart', () => ({
  moveMoovToFront: (bytes: Uint8Array) => moveMoovToFront(bytes),
}))

const { storeAttachment, UNSUPPORTED_ATTACHMENT_MESSAGE } = await import('./attachmentStore')

const UUID = '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6'
const MB = 1024 * 1024
const enc = new TextEncoder()

const UNSUPPORTED =
  '対応していない形式です (画像: png/jpg/gif/webp/avif/heic/tiff, 音声: mp3/m4a/wav/webm, 動画: mp4/webm/mov, PDF: pdf, テキスト: txt/csv/md)'

// --- バイト列の組み立て (判定に要る先頭だけを模す) ---

function concat(parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  parts.reduce((at, part) => {
    out.set(part, at)
    return at + part.length
  }, 0)
  return out
}

// 先頭に head を置き、残りを 0 で埋めて size バイトにする
function padded(head: ArrayLike<number>, size: number): Uint8Array<ArrayBuffer> {
  return concat([head, new Uint8Array(Math.max(0, size - head.length))])
}

const ascii = (text: string): Uint8Array<ArrayBuffer> => concat([enc.encode(text)])

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
const GIF = ascii('GIF89a')
const WEBP = ascii('RIFF\0\0\0\0WEBP')
const TIFF = ascii('II*\0')
const PDF = ascii('%PDF-1.7\n')
const SVG = ascii('<svg onload=alert(1)>')
const HTML = ascii('<html><script>alert(1)</script></html>')

// ISO-BMFF の汎用ボックス [長さ(4)][型(4)][中身]
function box(type: string, payload: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const out = concat([new Uint8Array(4), enc.encode(type), payload])
  new DataView(out.buffer).setUint32(0, out.byteLength)
  return out
}

// ftyp: major brand(4) + minor version(4) + compatible brands(4*n)
function ftyp(major: string, compatible: string[] = [major]): Uint8Array<ArrayBuffer> {
  const brands = compatible.map((brand) => enc.encode(brand))
  return box('ftyp', concat([enc.encode(major), new Uint8Array(4), ...brands]))
}

// ftyp + moov(trak(mdia(hdlr))) の最小 mp4。hdlr の中身は
// version+flags(4) → pre_defined(4) → handler(4) → 予備
function isoMedia(major: string, handlers: string[], size = 0): Uint8Array<ArrayBuffer> {
  const hdlr = (handler: string) =>
    box('hdlr', padded(concat([new Uint8Array(8), enc.encode(handler)]), 25))
  const traks = handlers.map((handler) => box('trak', box('mdia', hdlr(handler))))
  const media = concat([ftyp(major), box('moov', concat(traks))])
  return padded(media, size)
}

// EBML マジック + Tracks に現れる CodecID 文字列だけのダミー webm
function webm(codecIds: string[]): Uint8Array<ArrayBuffer> {
  return concat([[0x1a, 0x45, 0xdf, 0xa3], ...codecIds.map((id) => enc.encode(id))])
}

const MOVED = Uint8Array.from([0x6d, 0x6f, 0x6f, 0x76]) // moov を詰め替えた結果の目印
const POSTER = Uint8Array.from([0x70, 0x6f, 0x73]) // 作り直した poster の目印
const ANIM = Uint8Array.from([0x61, 0x6e, 0x69]) // 動くサムネの目印
const NORMALIZED = Uint8Array.from([0x6e, 0x6f, 0x72]) // 正規化後の画像の目印

const stored = (ext: string, isImage: boolean) => ({
  ok: true,
  url: `/api/images/${UUID}.${ext}`,
  name: `${UUID}.${ext}`,
  isImage,
})

beforeEach(() => {
  vi.clearAllMocks()
  const urlFor = async (_bytes: unknown, _mime: unknown, ext: unknown) =>
    `/api/images/${UUID}.${String(ext)}`
  saveImage.mockImplementation(urlFor)
  savePlainAttachment.mockImplementation(urlFor)
  normalizeImage.mockResolvedValue({ bytes: NORMALIZED, mime: 'image/webp', ext: 'webp' })
  makeThumbnail.mockResolvedValue(POSTER)
  makeVideoAnim.mockResolvedValue(null)
  moveMoovToFront.mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('対応外の文言は形式の一覧を並べた 1 本だけ', () => {
  expect(UNSUPPORTED_ATTACHMENT_MESSAGE).toBe(UNSUPPORTED)
})

describe('画像', () => {
  test.each([
    ['png', PNG],
    ['jpg', JPEG],
    ['gif', GIF],
    ['webp', WEBP],
    ['tiff', TIFF],
    ['heic', ftyp('heic', ['heic', 'mif1'])],
    ['avif', ftyp('avif', ['avif', 'mif1'])],
  ])('%s は中身で判定して正規化してから saveImage に回す', async (format, bytes) => {
    // Arrange
    const options = { deferEmbedding: true, fileName: 'notes.txt', maxBytes: 5 * MB }

    // Act
    const result = await storeAttachment(bytes, options)

    // Assert
    expect(result).toEqual(stored('webp', true))
    expect(normalizeImage).toHaveBeenCalledWith(bytes, format)
    // options は丸ごと渡る (deferEmbedding / awaitEmbedding を saveImage が読む)
    expect(saveImage).toHaveBeenCalledWith(NORMALIZED, 'image/webp', 'webp', options)
    expect(savePlainAttachment).not.toHaveBeenCalled()
  })

  test('options を省くと saveImage には空の options が渡る', async () => {
    await storeAttachment(PNG)

    expect(saveImage).toHaveBeenCalledWith(NORMALIZED, 'image/webp', 'webp', {})
  })

  test('正規化に失敗した画像は理由付きで断り、ログに形式と大きさを残す', async () => {
    // Arrange
    const bytes = ftyp('heic', ['heic'])
    const error = new Error('decode failed')
    normalizeImage.mockRejectedValue(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Act
    const result = await storeAttachment(bytes)

    // Assert
    expect(result).toEqual({
      ok: false,
      reason: '画像を読み込めませんでした (壊れているか未対応の画像です)',
    })
    expect(consoleError).toHaveBeenCalledWith(
      `画像の正規化に失敗しました (heic, ${bytes.byteLength} bytes):`,
      error,
    )
    expect(saveImage).not.toHaveBeenCalled()
  })

  test('動画用の poster とコマは画像では使わない', async () => {
    const result = await storeAttachment(PNG, {
      videoThumb: JPEG,
      videoFrames: [JPEG, JPEG, JPEG],
    })

    expect(result).toEqual(stored('webp', true))
    expect(makeThumbnail).not.toHaveBeenCalled()
    expect(makeVideoAnim).not.toHaveBeenCalled()
  })

  // 名前は形式を決めない。テキスト名でも署名のある中身が勝つ
  test('名前が txt でも中身が PNG なら画像として保存する', async () => {
    const result = await storeAttachment(PNG, { fileName: 'notes.txt' })

    expect(result).toEqual(stored('webp', true))
    expect(savePlainAttachment).not.toHaveBeenCalled()
  })
})

describe('動画', () => {
  test('mp4 は moov を先頭へ移したものを保存する', async () => {
    // Arrange
    const bytes = isoMedia('iso5', ['vide', 'soun'])
    moveMoovToFront.mockReturnValue(MOVED)

    // Act
    const result = await storeAttachment(bytes)

    // Assert
    expect(result).toEqual(stored('mp4', false))
    expect(moveMoovToFront).toHaveBeenCalledWith(bytes)
    expect(savePlainAttachment).toHaveBeenCalledWith(MOVED, 'video/mp4', 'mp4', {
      thumb: null,
      thumbAnim: null,
    })
    expect(makeThumbnail).not.toHaveBeenCalled()
    expect(makeVideoAnim).toHaveBeenCalledWith([], 'video anim')
    expect(saveImage).not.toHaveBeenCalled()
  })

  test('mov は詰め替えられなければ元のバイト列のまま保存する', async () => {
    const bytes = isoMedia('qt  ', ['vide', 'soun'])

    const result = await storeAttachment(bytes)

    expect(result).toEqual(stored('mov', false))
    expect(savePlainAttachment).toHaveBeenCalledWith(bytes, 'video/quicktime', 'mov', {
      thumb: null,
      thumbAnim: null,
    })
  })

  test('webm 動画は詰め替えずに .mkv で保存する', async () => {
    const bytes = webm(['V_VP9', 'A_OPUS'])

    const result = await storeAttachment(bytes)

    expect(result).toEqual(stored('mkv', false))
    expect(moveMoovToFront).not.toHaveBeenCalled()
    expect(savePlainAttachment).toHaveBeenCalledWith(bytes, 'video/webm', 'mkv', {
      thumb: null,
      thumbAnim: null,
    })
  })

  test('画像として読める poster は sharp で作り直して付ける', async () => {
    const bytes = webm(['V_VP8'])

    await storeAttachment(bytes, { videoThumb: JPEG })

    expect(makeThumbnail).toHaveBeenCalledWith(JPEG, 'video poster')
    expect(savePlainAttachment).toHaveBeenCalledWith(bytes, 'video/webm', 'mkv', {
      thumb: POSTER,
      thumbAnim: null,
    })
  })

  test.each([
    ['画像でない', SVG],
    ['200KB を超える', padded(WEBP, MAX_VIDEO_THUMB_BYTES + 1)],
    ['空の', new Uint8Array(0)],
  ])('%s poster は作り直さずに捨てる', async (_label, videoThumb) => {
    const bytes = webm(['V_VP8'])

    const result = await storeAttachment(bytes, { videoThumb })

    expect(result).toEqual(stored('mkv', false))
    expect(makeThumbnail).not.toHaveBeenCalled()
    expect(savePlainAttachment).toHaveBeenCalledWith(bytes, 'video/webm', 'mkv', {
      thumb: null,
      thumbAnim: null,
    })
  })

  test('コマは 1 枚ずつ検査して通ったものだけを動くサムネに回す', async () => {
    // Arrange
    const bytes = webm(['V_AV1'])
    const tooLarge = padded(JPEG, MAX_VIDEO_ANIM_FRAME_BYTES + 1)
    makeVideoAnim.mockResolvedValue(ANIM)

    // Act
    await storeAttachment(bytes, { videoFrames: [JPEG, SVG, tooLarge, PNG] })

    // Assert: poster が無くても動くサムネは独立に付く
    expect(makeVideoAnim).toHaveBeenCalledWith([JPEG, PNG], 'video anim')
    expect(savePlainAttachment).toHaveBeenCalledWith(bytes, 'video/webm', 'mkv', {
      thumb: null,
      thumbAnim: ANIM,
    })
  })

  test('poster が作れなくても動くサムネは付く', async () => {
    const bytes = webm(['V_VP9'])
    makeThumbnail.mockResolvedValue(null)
    makeVideoAnim.mockResolvedValue(ANIM)

    await storeAttachment(bytes, { videoThumb: JPEG, videoFrames: [JPEG, JPEG, JPEG] })

    expect(savePlainAttachment).toHaveBeenCalledWith(bytes, 'video/webm', 'mkv', {
      thumb: null,
      thumbAnim: ANIM,
    })
  })

  // 動画は 10MB の共通検査より**先に**判定する (30MB まで許すため)
  test('10MB を超える動画も共通の上限に当たらずに保存する', async () => {
    const bytes = isoMedia('isom', ['vide'], MAX_IMAGE_BYTES + 1)

    const result = await storeAttachment(bytes)

    expect(result).toEqual(stored('mp4', false))
  })

  // maxBytes は「動画以外」の上限。デモの 2MB は route の門が先に絞る
  test('動画は maxBytes を見ない', async () => {
    const bytes = isoMedia('isom', ['vide'], 3 * MB)

    const result = await storeAttachment(bytes, { maxBytes: 2 * MB })

    expect(result).toEqual(stored('mp4', false))
  })

  test('ちょうど 30MB の動画は保存する', async () => {
    const bytes = isoMedia('isom', ['vide'], MAX_VIDEO_BYTES)

    const result = await storeAttachment(bytes)

    expect(result).toEqual(stored('mp4', false))
  })

  test('30MB を超える動画は poster を作る前に断る', async () => {
    const bytes = isoMedia('isom', ['vide'], MAX_VIDEO_BYTES + 1)

    const result = await storeAttachment(bytes, { videoThumb: JPEG })

    expect(result).toEqual({ ok: false, reason: 'ファイルが大きすぎます (最大 30MB)' })
    expect(makeThumbnail).not.toHaveBeenCalled()
    expect(makeVideoAnim).not.toHaveBeenCalled()
    expect(savePlainAttachment).not.toHaveBeenCalled()
  })
})

describe('音声', () => {
  test.each([
    ['mp3 (ID3)', ascii('ID3\x04\x00'), 'audio/mpeg', 'mp3'],
    ['mp3 (同期語)', Uint8Array.from([0xff, 0xfb, 0x90, 0x00]), 'audio/mpeg', 'mp3'],
    ['wav', ascii('RIFF\0\0\0\0WAVE'), 'audio/wav', 'wav'],
    ['webm', webm(['A_OPUS']), 'audio/webm', 'webm'],
  ])('%s はそのまま保存する', async (_label, bytes, mime, ext) => {
    const result = await storeAttachment(bytes)

    expect(result).toEqual(stored(ext, false))
    expect(savePlainAttachment).toHaveBeenCalledWith(bytes, mime, ext)
    expect(moveMoovToFront).not.toHaveBeenCalled()
  })

  test('m4a は moov を先頭へ移したものを保存する', async () => {
    const bytes = ftyp('M4A ', ['M4A ', 'mp42'])
    moveMoovToFront.mockReturnValue(MOVED)

    const result = await storeAttachment(bytes)

    expect(result).toEqual(stored('m4a', false))
    expect(moveMoovToFront).toHaveBeenCalledWith(bytes)
    expect(savePlainAttachment).toHaveBeenCalledWith(MOVED, 'audio/mp4', 'm4a')
  })

  test('音声のみの mp4 は動画ではなく m4a として保存する (詰め替えなしなら元のまま)', async () => {
    const bytes = isoMedia('iso5', ['soun'])

    const result = await storeAttachment(bytes)

    expect(result).toEqual(stored('m4a', false))
    expect(savePlainAttachment).toHaveBeenCalledWith(bytes, 'audio/mp4', 'm4a')
  })
})

describe('PDF', () => {
  test('先頭が %PDF- ならそのまま保存する', async () => {
    const result = await storeAttachment(PDF)

    expect(result).toEqual(stored('pdf', false))
    expect(savePlainAttachment).toHaveBeenCalledWith(PDF, 'application/pdf', 'pdf')
  })

  // テキストは最後に試す。テキストとして読める PDF を横取りしない
  test('名前が txt でもテキストとして読める PDF は PDF として保存する', async () => {
    const result = await storeAttachment(PDF, { fileName: 'paper.txt' })

    expect(result).toEqual(stored('pdf', false))
  })
})

describe('テキスト', () => {
  test('名前の拡張子で mime を決め、UTF-8 に正規化して保存する', async () => {
    const result = await storeAttachment(ascii('a,b\n1,2\n'), { fileName: '売上.CSV' })

    expect(result).toEqual(stored('csv', false))
    expect(savePlainAttachment).toHaveBeenCalledWith(
      ascii('a,b\n1,2\n'),
      'text/csv; charset=utf-8',
      'csv',
    )
  })

  test('名前が無ければテキストとして受けない', async () => {
    const result = await storeAttachment(ascii('# 見出し\n'))

    expect(result).toEqual({ ok: false, reason: UNSUPPORTED })
    expect(savePlainAttachment).not.toHaveBeenCalled()
  })

  test('名前が txt/csv/md 以外なら中身が読めても受けない', async () => {
    const result = await storeAttachment(HTML, { fileName: 'evil.html' })

    expect(result).toEqual({ ok: false, reason: UNSUPPORTED })
  })

  test('名前がテキストでも中身がバイナリなら受けない', async () => {
    const binary = Uint8Array.from([0x00, 0x01, 0x02])

    const result = await storeAttachment(binary, { fileName: 'data.txt' })

    expect(result).toEqual({ ok: false, reason: UNSUPPORTED })
    expect(savePlainAttachment).not.toHaveBeenCalled()
  })

  test('空のファイルは名前がテキストでも受けない', async () => {
    const result = await storeAttachment(new Uint8Array(0), { fileName: 'empty.md' })

    expect(result).toEqual({ ok: false, reason: UNSUPPORTED })
  })

  // UTF-16LE の BOM `FF FE` は緩い MP3 判定に当たる。名前がテキストなら先に確定させる
  test('UTF-16 の BOM を持つテキストは音声判定より先にテキストとして保存する', async () => {
    const bytes = Uint8Array.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]) // "hi"

    const result = await storeAttachment(bytes, { fileName: 'memo.txt' })

    expect(result).toEqual(stored('txt', false))
    expect(savePlainAttachment).toHaveBeenCalledWith(
      ascii('hi'),
      'text/plain; charset=utf-8',
      'txt',
    )
  })

  test('UTF-16 の BOM でも名前がテキストでなければ音声判定に委ねる', async () => {
    const bytes = Uint8Array.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])

    const result = await storeAttachment(bytes, { fileName: 'voice.mp3' })

    expect(result).toEqual(stored('mp3', false))
    expect(savePlainAttachment).toHaveBeenCalledWith(bytes, 'audio/mpeg', 'mp3')
  })

  test('UTF-16 の BOM でテキスト名なのに読めなければ、音声は試さずに断る', async () => {
    const bytes = Uint8Array.from([0xff, 0xfe, 0x01, 0x00]) // U+0001 (制御文字)

    const result = await storeAttachment(bytes, { fileName: 'memo.txt' })

    expect(result).toEqual({ ok: false, reason: UNSUPPORTED })
    expect(savePlainAttachment).not.toHaveBeenCalled()
  })
})

describe('対応外', () => {
  test.each([
    ['SVG', SVG, undefined],
    ['.png を名乗る HTML', HTML, 'photo.png'],
    ['映像も音声も無い webm', webm([]), undefined],
    ['映像トラックの無い ftyp', ftyp('isom', ['isom', 'mp42']), undefined],
  ])('%s は理由付きで断る', async (_label, bytes, fileName) => {
    const result = await storeAttachment(bytes, { fileName })

    expect(result).toEqual({ ok: false, reason: UNSUPPORTED })
    expect(saveImage).not.toHaveBeenCalled()
    expect(savePlainAttachment).not.toHaveBeenCalled()
  })
})

describe('動画以外の上限', () => {
  test('既定は 10MB (ちょうどは通す)', async () => {
    const result = await storeAttachment(padded(PNG, MAX_IMAGE_BYTES))

    expect(result).toEqual(stored('webp', true))
  })

  test.each([
    ['画像', PNG],
    ['音声', ascii('ID3\x04\x00')],
    ['PDF', PDF],
  ])('10MB を超える%sは判定の前に断る', async (_label, head) => {
    const result = await storeAttachment(padded(head, MAX_IMAGE_BYTES + 1))

    expect(result).toEqual({ ok: false, reason: 'ファイルが大きすぎます (最大 10MB)' })
    expect(normalizeImage).not.toHaveBeenCalled()
    expect(savePlainAttachment).not.toHaveBeenCalled()
  })

  // 大きさの検査は形式の判定より先。対応外の中身でも「大きすぎる」が返る
  test('上限を超えた対応外の中身は「大きすぎる」で断る', async () => {
    const result = await storeAttachment(padded(HTML, MAX_IMAGE_BYTES + 1))

    expect(result).toEqual({ ok: false, reason: 'ファイルが大きすぎます (最大 10MB)' })
  })

  test('maxBytes で上限を差し替えられる (デモの 2MB)', async () => {
    const result = await storeAttachment(padded(PDF, 2 * MB + 1), { maxBytes: 2 * MB })

    expect(result).toEqual({ ok: false, reason: 'ファイルが大きすぎます (最大 2MB)' })
  })

  test('maxBytes を広げれば 10MB を超える写真も保存する (CLI 取り込み)', async () => {
    const result = await storeAttachment(padded(JPEG, 12 * MB), { maxBytes: 50 * MB })

    expect(result).toEqual(stored('webp', true))
    expect(normalizeImage).toHaveBeenCalledWith(expect.any(Uint8Array), 'jpg')
  })
})
