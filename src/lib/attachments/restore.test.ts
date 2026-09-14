import { beforeEach, expect, test, vi } from 'vitest'

// DB (imageStore) は差し替える。見たいのは restoreAttachment の判定 —
// 形式の裏付けと大きさの線引きであって、行の作成ではない
const restoreAttachmentRow = vi.fn()

vi.mock('@/lib/images/imageStore', () => ({
  restoreAttachmentRow: (name: string, bytes: Uint8Array, mime: string) =>
    restoreAttachmentRow(name, bytes, mime),
  saveImage: vi.fn(),
  savePlainAttachment: vi.fn(),
}))

const { restoreAttachment } = await import('./restore')
const { MAX_ZIP_FILE_BYTES } = await import('@/lib/zip/limits')

const UUID = '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6'

// JPEG の先頭バイト (FF D8 FF) を持つ指定サイズのバイト列
function fakeJpeg(bytes: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(bytes)
  data.set([0xff, 0xd8, 0xff, 0xe0])
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  restoreAttachmentRow.mockResolvedValue(true)
})

// CLI 取り込みで入った iPhone 写真 (11〜12MB) が復元で弾かれた退行。
// 上限は Web アップロードの 10MB ではなく「DB に入りうる最大」(50MB) で見る
test('10MB を超える画像も復元できる (CLI 取り込み由来の写真)', async () => {
  const result = await restoreAttachment(`${UUID}.jpg`, fakeJpeg(12 * 1024 * 1024))
  expect(result).toEqual({ ok: true, created: true })
})

test('DB に入りえない大きさ (50MB 超) は理由付きで断る', async () => {
  const result = await restoreAttachment(`${UUID}.jpg`, fakeJpeg(MAX_ZIP_FILE_BYTES + 1))
  expect(result.ok).toBe(false)
  expect(restoreAttachmentRow).not.toHaveBeenCalled()
})

// 「.png という名前の HTML」を保存して配信させない (mime は DB の値が
// そのまま Content-Type になる)
test('拡張子と中身が食い違う添付は断る', async () => {
  const html = new TextEncoder().encode('<html></html>') as Uint8Array<ArrayBuffer>
  const result = await restoreAttachment(`${UUID}.png`, html)
  expect(result.ok).toBe(false)
  expect(restoreAttachmentRow).not.toHaveBeenCalled()
})

// --- 種別ごとの裏付け (名乗った拡張子を中身が支えるか) ---

const enc = new TextEncoder()

function concat(parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  parts.reduce((at, part) => {
    out.set(part, at)
    return at + part.length
  }, 0)
  return out
}

const ascii = (text: string) => concat([enc.encode(text)])

// ISO-BMFF の汎用ボックス [長さ(4)][型(4)][中身]
function box(type: string, payload: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const out = concat([new Uint8Array(4), enc.encode(type), payload])
  new DataView(out.buffer).setUint32(0, out.byteLength)
  return out
}

// ftyp + moov(trak(mdia(hdlr))) の最小 mp4 (hdlr の handler は offset 8)
function isoMedia(major: string, handlers: string[]): Uint8Array<ArrayBuffer> {
  const hdlr = (handler: string) =>
    box('hdlr', concat([new Uint8Array(8), enc.encode(handler), new Uint8Array(13)]))
  return concat([
    box('ftyp', concat([enc.encode(major), new Uint8Array(4), enc.encode(major)])),
    box('moov', concat(handlers.map((h) => box('trak', box('mdia', hdlr(h)))))),
  ])
}

const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const webm = (codecIds: string[]) =>
  concat([[0x1a, 0x45, 0xdf, 0xa3], ...codecIds.map((id) => enc.encode(id))])

test.each([
  ['mp4 動画', `${UUID}.mp4`, isoMedia('isom', ['vide', 'soun']), 'video/mp4'],
  ['mov 動画', `${UUID}.mov`, isoMedia('qt  ', ['vide']), 'video/quicktime'],
  ['webm 動画 (.mkv)', `${UUID}.mkv`, webm(['V_VP9', 'A_OPUS']), 'video/webm'],
  ['png', `${UUID}.png`, PNG_HEAD, 'image/png'],
  ['m4a', `${UUID}.m4a`, isoMedia('M4A ', []), 'audio/mp4'],
  ['webm 音声', `${UUID}.webm`, webm(['A_OPUS']), 'audio/webm'],
  ['pdf', `${UUID}.pdf`, ascii('%PDF-1.7\n'), 'application/pdf'],
])('%s は元の名前と中身のまま行を作る', async (_label, name, bytes, mime) => {
  // Act
  const result = await restoreAttachment(name, bytes)

  // Assert: 復元では moov の詰め替えも正規化もしない
  expect(result).toEqual({ ok: true, created: true })
  expect(restoreAttachmentRow).toHaveBeenCalledWith(name, bytes, mime)
})

test('テキストは UTF-8 に正規化した中身で行を作る', async () => {
  const bytes = Uint8Array.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]) // UTF-16LE の "hi"

  const result = await restoreAttachment(`${UUID}.md`, bytes)

  expect(result).toEqual({ ok: true, created: true })
  expect(restoreAttachmentRow).toHaveBeenCalledWith(
    `${UUID}.md`,
    ascii('hi'),
    'text/markdown; charset=utf-8',
  )
})

test('同じ名前の行が既にあれば created: false を返す', async () => {
  restoreAttachmentRow.mockResolvedValue(false)

  const result = await restoreAttachment(`${UUID}.jpg`, fakeJpeg(16))

  expect(result).toEqual({ ok: true, created: false })
})

test.each([
  ['音声の mp4 を .mp4 と名乗る', `${UUID}.mp4`, isoMedia('mp42', ['soun']), 'mp4'],
  ['mp4 を .mov と名乗る', `${UUID}.mov`, isoMedia('isom', ['vide']), 'mov'],
  ['HEIC のまま .jpg と名乗る', `${UUID}.jpg`, box('ftyp', ascii('heic\0\0\0\0heic')), 'jpg'],
  ['JPEG を .png と名乗る', `${UUID}.png`, fakeJpeg(16), 'png'],
  ['mp3 を .wav と名乗る', `${UUID}.wav`, ascii('ID3\x04\x00'), 'wav'],
  ['PDF でない中身を .pdf と名乗る', `${UUID}.pdf`, ascii('<html>'), 'pdf'],
  ['バイナリを .txt と名乗る', `${UUID}.txt`, Uint8Array.from([0x00, 0x01]), 'txt'],
])('%s 添付は食い違いとして断る', async (_label, name, bytes, ext) => {
  const result = await restoreAttachment(name, bytes)

  expect(result).toEqual({ ok: false, reason: `中身が拡張子 (.${ext}) と一致しません` })
  expect(restoreAttachmentRow).not.toHaveBeenCalled()
})

test('どの種別の名前でもないものは対応外として断る', async () => {
  const result = await restoreAttachment(`${UUID}.svg`, ascii('<svg/>'))

  expect(result).toEqual({
    ok: false,
    reason:
      '対応していない形式です (画像: png/jpg/gif/webp/avif/heic/tiff, 音声: mp3/m4a/wav/webm, 動画: mp4/webm/mov, PDF: pdf, テキスト: txt/csv/md)',
  })
})

test('大きすぎる添付の理由は DB に入りうる最大 (50MB) を示す', async () => {
  const result = await restoreAttachment(`${UUID}.jpg`, fakeJpeg(MAX_ZIP_FILE_BYTES + 1))

  expect(result).toEqual({ ok: false, reason: 'ファイルが大きすぎます (最大 50MB)' })
})
