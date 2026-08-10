import { afterEach, expect, test } from 'vitest'
import {
  audioSaveInfo,
  checkUploadRequest,
  DEMO_MAX_IMAGE_BYTES,
  extForMime,
  isAllowedContentMime,
  isValidAttachmentName,
  isValidAudioName,
  isValidImageName,
  isValidPdfName,
  maxAttachmentBytes,
  MAX_IMAGE_BYTES,
  maxUploadBytes,
  PDF_MIME,
  sniffAudioFormat,
  isValidTextName,
  isValidVideoName,
  isValidVideoAnimFrame,
  isValidVideoThumb,
  MAX_VIDEO_ANIM_FRAME_BYTES,
  MAX_VIDEO_ANIM_FRAMES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_THUMB_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  sniffImageFormat,
  sniffPdf,
  sniffVideoFormat,
  textSaveInfo,
  videoSaveInfo,
} from './uploads'

const originalDemo = process.env.DEMO_MODE

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

test('対応する画像 MIME は拡張子を返す', () => {
  expect(extForMime('image/png')).toBe('png')
  expect(extForMime('image/jpeg')).toBe('jpg')
  expect(extForMime('image/gif')).toBe('gif')
  expect(extForMime('image/webp')).toBe('webp')
  expect(extForMime('image/avif')).toBe('avif')
})

test('画像以外・危険な MIME は null を返す', () => {
  expect(extForMime('image/svg+xml')).toBeNull() // SVG はスクリプト埋め込み可能なため拒否
  expect(extForMime('text/html')).toBeNull()
  expect(extForMime('application/pdf')).toBeNull()
  expect(extForMime('')).toBeNull()
})

test('UUID + 対応拡張子のファイル名だけを許可する', () => {
  expect(
    isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.png'),
  ).toBe(true)
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.jpg')).toBe(true)
  // AVIF は無変換で保存するので保存名にも現れる
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.avif')).toBe(true)
})

test('パストラバーサル・不正なファイル名を拒否する', () => {
  expect(isValidImageName('../../etc/passwd')).toBe(false)
  expect(isValidImageName('..%2Fsecret.png')).toBe(false)
  expect(isValidImageName('a.png')).toBe(false) // UUID 形式でない
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.svg')).toBe(false)
  // HEIC/TIFF は保存時に webp へ変換するため、この拡張子で保存名は作られない
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.heic')).toBe(false)
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678.tiff')).toBe(false)
  expect(isValidImageName('0f1e2d3c-4b5a-4678-9abc-def012345678')).toBe(false)
  expect(isValidImageName('')).toBe(false)
})

test('サイズ上限は 10MB', () => {
  expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024)
})

// docs/38-デモモード計画.md §5。デモは 1 ファイルを 2MB に縮める
// maxUploadBytes はリクエストの「門」= 全種別の最大 (動画 30MB)。デモは 2MB。
// 種別ごとの上限は maxAttachmentBytes (動画以外 10MB) が別に持つ。
test('maxUploadBytes は通常 30MB (動画枠) / デモは 2MB', () => {
  delete process.env.DEMO_MODE
  expect(maxUploadBytes()).toBe(MAX_VIDEO_BYTES)
  expect(maxAttachmentBytes()).toBe(MAX_IMAGE_BYTES)

  process.env.DEMO_MODE = '1'
  expect(maxUploadBytes()).toBe(DEMO_MAX_IMAGE_BYTES)
  expect(maxAttachmentBytes()).toBe(DEMO_MAX_IMAGE_BYTES)
  expect(DEMO_MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024)
})

// 本文の事前チェック (Content-Length) もデモ上限で効くこと。
// 通常なら通る 5MB が、デモでは 2MB を超えるので 413 で弾かれる
test('checkUploadRequest の本文上限もデモでは 2MB に縮む', () => {
  const fiveMB = String(5 * 1024 * 1024)

  delete process.env.DEMO_MODE
  expect(
    checkUploadRequest(uploadRequest({ host: 'localhost', 'content-length': fiveMB })),
  ).toBeNull()

  process.env.DEMO_MODE = '1'
  expect(
    checkUploadRequest(uploadRequest({ host: 'localhost', 'content-length': fiveMB }))
      ?.status,
  ).toBe(413)
})

const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
const GIF_HEAD = new TextEncoder().encode('GIF89a')
const WEBP_HEAD = new TextEncoder().encode('RIFF\0\0\0\0WEBP')

// ISO-BMFF (HEIC/AVIF) の ftyp ボックスを手で組む。
// 構造: size(4) + "ftyp"(4) + major brand(4) + minor version(4) + compatible brands(4*n)
function ftypBox(major: string, compatible: string[]): Uint8Array {
  const enc = new TextEncoder()
  const size = 8 + 4 + 4 + compatible.length * 4
  const buf = new Uint8Array(size)
  new DataView(buf.buffer).setUint32(0, size) // ボックス長 (big-endian)
  buf.set(enc.encode('ftyp'), 4)
  buf.set(enc.encode(major), 8)
  // minor version (12..16) は 0 のまま
  compatible.forEach((brand, i) => buf.set(enc.encode(brand), 16 + i * 4))
  return buf
}

test('先頭バイトから画像形式を判定する (sniff)', () => {
  expect(sniffImageFormat(PNG_HEAD)).toBe('png')
  expect(sniffImageFormat(JPEG_HEAD)).toBe('jpg')
  expect(sniffImageFormat(GIF_HEAD)).toBe('gif')
  expect(sniffImageFormat(WEBP_HEAD)).toBe('webp')
})

test('TIFF は big/little endian の両署名を判定する', () => {
  expect(sniffImageFormat(new TextEncoder().encode('II*\0'))).toBe('tiff') // little
  expect(sniffImageFormat(Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a]))).toBe('tiff') // big
})

test('HEIC は ftyp のブランドで判定する', () => {
  expect(sniffImageFormat(ftypBox('heic', ['heic', 'mif1']))).toBe('heic')
  expect(sniffImageFormat(ftypBox('heix', ['heix', 'mif1']))).toBe('heic')
  // iPhone / Nokia サンプルは major=mif1、compatible に heic が入る形
  expect(sniffImageFormat(ftypBox('mif1', ['mif1', 'heic']))).toBe('heic')
})

test('AVIF は ftyp のブランドで判定する (mif1 兼用でも avif を優先)', () => {
  expect(sniffImageFormat(ftypBox('avif', ['avif', 'mif1']))).toBe('avif')
  expect(sniffImageFormat(ftypBox('avis', ['avis', 'avif']))).toBe('avif')
  // major=mif1 でも compatible に avif があれば AVIF (heic より優先して判定)
  expect(sniffImageFormat(ftypBox('mif1', ['mif1', 'avif']))).toBe('avif')
})

test('画像でない・未対応の中身は null (形式判定)', () => {
  const html = new TextEncoder().encode('<html><script>alert(1)</script>')
  expect(sniffImageFormat(html)).toBeNull()
  expect(sniffImageFormat(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
  expect(sniffImageFormat(new Uint8Array(0))).toBeNull()
  // ftyp だが未知ブランド (mp4 動画など) は画像として扱わない
  expect(sniffImageFormat(ftypBox('isom', ['isom', 'mp42']))).toBeNull()
})

test('切り詰めた入力でも throw しない (呼び出し側は try/catch しない)', () => {
  // ftyp を名乗る途中で切れたバイト列で例外を出さないこと。
  // sniffImageFormat は route / coverLookup が素で呼ぶので、throw すると
  // アップロードが 500 になり、書影取得は「throw しない」契約を破る。
  // major brand が揃う 12 バイト未満は null、揃えば形式が返る (どちらも throw しない)
  const ftypPrefix = new TextEncoder().encode('\0\0\0\x18ftypheic')
  for (let len = 0; len <= 16; len++) {
    const slice = ftypPrefix.subarray(0, len)
    expect(() => sniffImageFormat(slice)).not.toThrow()
    if (len < 12) {
      expect(sniffImageFormat(slice)).toBeNull() // major brand まで揃っていない
    }
  }
})

// --- 音声 (docs/12-添付ファイル種類拡張メモ.md) ---

test('先頭バイトから音声形式を判定する (mp3/wav/m4a)', () => {
  // mp3: ID3v2 タグ始まり
  expect(sniffAudioFormat(new TextEncoder().encode('ID3\x04\x00'))).toBe('mp3')
  // mp3: ID3 無しの生フレーム同期語 (0xFF 0xFB)
  expect(sniffAudioFormat(Uint8Array.from([0xff, 0xfb, 0x90, 0x00]))).toBe('mp3')
  // wav: RIFF....WAVE
  expect(sniffAudioFormat(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBe('wav')
  // m4a: ISO-BMFF の ftyp に音声ブランド (iPhone ボイスメモは "M4A ")
  expect(sniffAudioFormat(ftypBox('M4A ', ['M4A ', 'mp42', 'isom']))).toBe('m4a')
  expect(sniffAudioFormat(ftypBox('M4B ', ['M4B ']))).toBe('m4a')
})

test('音声でない・動画の ftyp は null (音声判定)', () => {
  // 画像 (PNG) は音声ではない
  expect(sniffAudioFormat(PNG_HEAD)).toBeNull()
  // JPEG (FF D8) は mp3 の同期語 (FF E0 マスク) と衝突しない
  expect(sniffAudioFormat(JPEG_HEAD)).toBeNull()
  // 動画の ftyp (mp42/isom 単独) は音声として受けない
  expect(sniffAudioFormat(ftypBox('isom', ['isom', 'mp42']))).toBeNull()
  expect(sniffAudioFormat(new TextEncoder().encode('<html>'))).toBeNull()
  expect(sniffAudioFormat(new Uint8Array(0))).toBeNull()
})

// --- ブラウザ録音の形式 (docs/12「ノート内録音の実装計画」) ---

// ISO-BMFF の汎用ボックス [長さ(4)][型(4)][中身]。
function box(type: string, payload: Uint8Array): Uint8Array {
  const enc = new TextEncoder()
  const buf = new Uint8Array(8 + payload.byteLength)
  new DataView(buf.buffer).setUint32(0, buf.byteLength)
  buf.set(enc.encode(type), 4)
  buf.set(payload, 8)
  return buf
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

// hdlr ボックス。中身は version+flags(4) → pre_defined(4) → handler(4) → 予備。
function hdlrBox(handler: string): Uint8Array {
  const payload = new Uint8Array(25)
  payload.set(new TextEncoder().encode(handler), 8)
  return box('hdlr', payload)
}

// ftyp + moov(trak(mdia(hdlr))) の最小 mp4。ハンドラ種別ごとに trak を作る。
function mp4WithHandlers(major: string, handlers: string[]): Uint8Array {
  const traks = handlers.map((h) =>
    box('trak', box('mdia', hdlrBox(h))),
  )
  return concatBytes([
    ftypBox(major, [major]),
    box('moov', concatBytes(traks)),
  ])
}

// EBML マジック + CodecID 文字列を含むダミー webm。実ファイルの Tracks 要素に
// 現れる CodecID を判定に使うので、判定に必要な部分だけを模す。
function webmFile(codecIds: string[], padding = 0): Uint8Array {
  const enc = new TextEncoder()
  return concatBytes([
    Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]),
    new Uint8Array(padding),
    ...codecIds.map((id) => enc.encode(id)),
  ])
}

test('webm は音声 CodecID があり映像 CodecID が無いときだけ音声と判定する', () => {
  // Chrome / Android の MediaRecorder が出す形 (Opus)
  expect(sniffAudioFormat(webmFile(['A_OPUS']))).toBe('webm')
  expect(sniffAudioFormat(webmFile(['A_VORBIS']))).toBe('webm')
})

test('映像トラックを含む webm・音声と判らない webm は受けない', () => {
  // 映像のみ
  expect(sniffAudioFormat(webmFile(['V_VP9']))).toBeNull()
  // 音声トラックを持つ動画 (これを通すと動画が音声として保存されてしまう)
  expect(sniffAudioFormat(webmFile(['V_VP9', 'A_OPUS']))).toBeNull()
  expect(sniffAudioFormat(webmFile(['V_VP8', 'A_OPUS']))).toBeNull()
  expect(sniffAudioFormat(webmFile(['V_AV1', 'A_OPUS']))).toBeNull()
  // EBML マジックだけでは音声と判らない
  expect(sniffAudioFormat(webmFile([]))).toBeNull()
  // 音声 CodecID の走査は先頭 64KB まで。それより後ろにしか無いものは
  // 安全側に倒して拒否する (実録音は先頭 300 バイト以内に入っている)
  expect(sniffAudioFormat(webmFile(['A_OPUS'], 64 * 1024))).toBeNull()
})

// security-reviewer の指摘 (MEDIUM)。映像 CodecID の走査まで先頭 64KB に
// 限ると、EBML の Void 要素で窓を埋めて映像トラックを走査範囲の外へ
// 押し出せてしまう。**映像側はファイル全体を見る**ことで塞ぐ
test('詰め物で 64KB の外へ押し出した映像 CodecID も見つける', () => {
  const enc = new TextEncoder()
  const padded = concatBytes([
    Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]),
    enc.encode('A_OPUS'),
    new Uint8Array(70 * 1024), // 走査窓を越えさせるための詰め物
    enc.encode('V_VP9'),
  ])
  expect(sniffAudioFormat(padded)).toBeNull()
})

test('mp4 は moov の hdlr が音声のみなら受ける (Safari の録音)', () => {
  // Safari の MediaRecorder は M4A ブランドを名乗らない。ブランドではなく
  // トラック構成で判定するので、iso5 系でも音声として受かる
  expect(sniffAudioFormat(mp4WithHandlers('iso5', ['soun']))).toBe('m4a')
  expect(sniffAudioFormat(mp4WithHandlers('mp42', ['soun']))).toBe('m4a')
})

test('映像トラックを含む mp4 は hdlr 判定でも受けない', () => {
  expect(sniffAudioFormat(mp4WithHandlers('isom', ['vide', 'soun']))).toBeNull()
  expect(sniffAudioFormat(mp4WithHandlers('isom', ['vide']))).toBeNull()
  // moov が無ければ従来どおりブランドだけが頼り
  expect(sniffAudioFormat(ftypBox('iso5', ['iso5']))).toBeNull()
})

test('録音形式を保存用の mime / ext に写す', () => {
  expect(audioSaveInfo('webm')).toEqual({ mime: 'audio/webm', ext: 'webm' })
})

test('webm の保存名と配信 mime を許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidAudioName(`${uuid}.webm`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.webm`)).toBe(true)
  expect(isAllowedContentMime('audio/webm')).toBe(true)
  // 音声の webm を一覧サムネ・画像検索に混ぜない (webp と 1 文字違いなので明示)
  expect(isValidImageName(`${uuid}.webm`)).toBe(false)
})

test('画像と音声の判定は互いに混ざらない', () => {
  // 画像判定は音声を拾わない
  expect(sniffImageFormat(new TextEncoder().encode('ID3\x04\x00'))).toBeNull()
  expect(sniffImageFormat(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBeNull()
  expect(sniffImageFormat(ftypBox('M4A ', ['M4A ']))).toBeNull()
})

test('音声形式を保存用の mime / ext に写す', () => {
  expect(audioSaveInfo('mp3')).toEqual({ mime: 'audio/mpeg', ext: 'mp3' })
  expect(audioSaveInfo('m4a')).toEqual({ mime: 'audio/mp4', ext: 'm4a' })
  expect(audioSaveInfo('wav')).toEqual({ mime: 'audio/wav', ext: 'wav' })
})

test('音声の保存名 (UUID + mp3/m4a/wav) を許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidAudioName(`${uuid}.mp3`)).toBe(true)
  expect(isValidAudioName(`${uuid}.m4a`)).toBe(true)
  expect(isValidAudioName(`${uuid}.wav`)).toBe(true)
  expect(isValidAudioName(`${uuid}.png`)).toBe(false) // 画像は音声名ではない
  expect(isValidAudioName('../../etc/passwd.mp3')).toBe(false)
})

test('isValidImageName は音声名を拾わない (一覧サムネ・画像検索に混ぜない)', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidImageName(`${uuid}.mp3`)).toBe(false)
  expect(isValidImageName(`${uuid}.m4a`)).toBe(false)
  expect(isValidImageName(`${uuid}.wav`)).toBe(false)
})

test('isValidAttachmentName は画像・音声の両方を許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidAttachmentName(`${uuid}.png`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.mp3`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.svg`)).toBe(false)
  expect(isValidAttachmentName('../secret.mp3')).toBe(false)
})

test('配信 Content-Type は既知の画像・音声・PDF mime だけ採用する', () => {
  expect(isAllowedContentMime('image/png')).toBe(true)
  expect(isAllowedContentMime('image/webp')).toBe(true)
  expect(isAllowedContentMime('audio/mpeg')).toBe(true)
  expect(isAllowedContentMime('audio/mp4')).toBe(true)
  expect(isAllowedContentMime('audio/wav')).toBe(true)
  expect(isAllowedContentMime(PDF_MIME)).toBe(true)
  // 動画も配信 mime として許可する (docs/14-動画挿入計画.md)
  expect(isAllowedContentMime('video/mp4')).toBe(true)
  expect(isAllowedContentMime('video/webm')).toBe(true)
  expect(isAllowedContentMime('video/quicktime')).toBe(true)
  // 未知・危険な mime は採用しない (route.ts が octet-stream に落とす)
  expect(isAllowedContentMime('image/svg+xml')).toBe(false)
  expect(isAllowedContentMime('text/html')).toBe(false)
})

// --- PDF (docs/12-添付ファイル種類拡張メモ.md) ---

test('先頭が "%PDF-" なら PDF と判定する', () => {
  expect(sniffPdf(new TextEncoder().encode('%PDF-1.7\n%âãÏÓ'))).toBe(true)
  expect(sniffPdf(new TextEncoder().encode('%PDF-1.4'))).toBe(true)
})

test('PDF でない中身・先頭がずれた PDF は false', () => {
  // 署名は offset 0 固定。前に何か付いたポリグロットは受けない
  expect(sniffPdf(new TextEncoder().encode('\n%PDF-1.7'))).toBe(false)
  expect(sniffPdf(new TextEncoder().encode('%PDX-1.7'))).toBe(false)
  expect(sniffPdf(new TextEncoder().encode('<html>'))).toBe(false)
  expect(sniffPdf(PNG_HEAD)).toBe(false)
  expect(sniffPdf(new Uint8Array(0))).toBe(false)
})

test('PDF は画像・音声の判定に混ざらない', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7')
  expect(sniffImageFormat(pdf)).toBeNull()
  expect(sniffAudioFormat(pdf)).toBeNull()
})

test('PDF の保存名 (UUID + .pdf) を許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidPdfName(`${uuid}.pdf`)).toBe(true)
  expect(isValidPdfName(`${uuid}.png`)).toBe(false)
  expect(isValidPdfName('../../etc/passwd.pdf')).toBe(false)
  expect(isValidPdfName('a.pdf')).toBe(false) // UUID 形式でない
})

// --- 動画 (docs/14-動画挿入計画.md) ---

test('webm は映像 CodecID があれば動画と判定する (音声判定の裏返し)', () => {
  // 映像のみ・映像+音声のどちらも動画
  expect(sniffVideoFormat(webmFile(['V_VP9']))).toBe('webm')
  expect(sniffVideoFormat(webmFile(['V_VP9', 'A_OPUS']))).toBe('webm')
  expect(sniffVideoFormat(webmFile(['V_VP8', 'A_OPUS']))).toBe('webm')
  expect(sniffVideoFormat(webmFile(['V_AV1']))).toBe('webm')
  // 音声のみ webm は動画ではない (sniffAudioFormat が拾う)
  expect(sniffVideoFormat(webmFile(['A_OPUS']))).toBeNull()
  // EBML マジックだけでは動画と判らない
  expect(sniffVideoFormat(webmFile([]))).toBeNull()
})

test('mp4/mov は moov に映像トラックがあれば動画と判定する', () => {
  // 一般的な mp4 (映像+音声)
  expect(sniffVideoFormat(mp4WithHandlers('isom', ['vide', 'soun']))).toBe('mp4')
  expect(sniffVideoFormat(mp4WithHandlers('mp42', ['vide']))).toBe('mp4')
  // Safari の録画は iso5 系ブランドでも映像トラックで拾える
  expect(sniffVideoFormat(mp4WithHandlers('iso5', ['vide', 'soun']))).toBe('mp4')
  // QuickTime (.mov) は major brand "qt  " で mov に振り分ける
  expect(sniffVideoFormat(mp4WithHandlers('qt  ', ['vide', 'soun']))).toBe('mov')
})

test('音声のみ・画像・空は動画として受けない', () => {
  // 音声のみの mp4 (soun だけ) は動画ではない
  expect(sniffVideoFormat(mp4WithHandlers('mp42', ['soun']))).toBeNull()
  // iPhone ボイスメモ (M4A ブランド・moov 無し) も動画ではない
  expect(sniffVideoFormat(ftypBox('M4A ', ['M4A ']))).toBeNull()
  expect(sniffVideoFormat(PNG_HEAD)).toBeNull()
  expect(sniffVideoFormat(new TextEncoder().encode('%PDF-1.7'))).toBeNull()
  expect(sniffVideoFormat(new Uint8Array(0))).toBeNull()
})

test('動画と音声の判定は互いに混ざらない', () => {
  // 音声のみは音声、映像入りは動画。両方が同じファイルを拾わない
  const audioWebm = webmFile(['A_OPUS'])
  expect(sniffAudioFormat(audioWebm)).toBe('webm')
  expect(sniffVideoFormat(audioWebm)).toBeNull()

  const videoWebm = webmFile(['V_VP9', 'A_OPUS'])
  expect(sniffAudioFormat(videoWebm)).toBeNull()
  expect(sniffVideoFormat(videoWebm)).toBe('webm')
})

// webm 動画の保存拡張子は `.mkv` (音声のみの .webm と URL 上で衝突させない。
// videoFormats.ts の経緯)。中身の形式 'webm' → 保存 ext 'mkv' に写す。
test('動画形式を保存用の mime / ext に写す (webm 動画は .mkv)', () => {
  expect(videoSaveInfo('mp4')).toEqual({ mime: 'video/mp4', ext: 'mp4' })
  expect(videoSaveInfo('webm')).toEqual({ mime: 'video/webm', ext: 'mkv' })
  expect(videoSaveInfo('mov')).toEqual({ mime: 'video/quicktime', ext: 'mov' })
})

test('動画の保存名 (UUID + mp4/mkv/mov) を許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidVideoName(`${uuid}.mp4`)).toBe(true)
  expect(isValidVideoName(`${uuid}.mkv`)).toBe(true)
  expect(isValidVideoName(`${uuid}.mov`)).toBe(true)
  // .webm は音声 (audio) の保存名。動画の保存名ではない (衝突回避)
  expect(isValidVideoName(`${uuid}.webm`)).toBe(false)
  expect(isValidVideoName(`${uuid}.png`)).toBe(false)
  expect(isValidVideoName('../../etc/passwd.mp4')).toBe(false)
  // 動画も添付名として許可する
  expect(isValidAttachmentName(`${uuid}.mp4`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.mkv`)).toBe(true)
  // 動画を一覧サムネ・画像検索に混ぜない
  expect(isValidImageName(`${uuid}.mp4`)).toBe(false)
})

test('動画のクライアントサムネは sharp が読める画像かつ 200KB 以下を受ける', () => {
  const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBP')
  expect(isValidVideoThumb(webp)).toBe(true)
  // JPEG・PNG も受ける (Safari は canvas で webp を出せないので JPEG に化ける。
  // サーバが sharp で webp へ作り直す)
  expect(isValidVideoThumb(JPEG_HEAD)).toBe(true)
  expect(isValidVideoThumb(PNG_HEAD)).toBe(true)
  // 画像でないもの (HTML/SVG) は拒否 (sniffImageFormat が null を返す)
  expect(isValidVideoThumb(new TextEncoder().encode('<svg onload=alert(1)>'))).toBe(false)
  // 空も拒否
  expect(isValidVideoThumb(new Uint8Array(0))).toBe(false)
  // 上限超過は拒否 (先頭は正しい WebP 署名でも大きさで弾く)
  const huge = new Uint8Array(MAX_VIDEO_THUMB_BYTES + 1)
  huge.set(webp, 0)
  expect(isValidVideoThumb(huge)).toBe(false)
})

test('動くサムネのコマは静止サムネより厳しい上限で受ける', () => {
  // 判定の考え方は poster と同じ (中身で決める) で、上限だけが違う。
  // コマは枚数ぶん積み上がるので 1 枚あたりを絞る
  expect(isValidVideoAnimFrame(JPEG_HEAD)).toBe(true)
  expect(isValidVideoAnimFrame(PNG_HEAD)).toBe(true)
  expect(
    isValidVideoAnimFrame(new TextEncoder().encode('<svg onload=alert(1)>')),
  ).toBe(false)
  expect(isValidVideoAnimFrame(new Uint8Array(0))).toBe(false)

  const huge = new Uint8Array(MAX_VIDEO_ANIM_FRAME_BYTES + 1)
  huge.set(JPEG_HEAD, 0)
  expect(isValidVideoAnimFrame(huge)).toBe(false)
})

test('コマの合計は multipart のオーバーヘッド枠に収まる', () => {
  // 動画本体の上限 + MULTIPART_OVERHEAD_BYTES が checkUploadRequest の門なので、
  // poster とコマの合計がこの枠を超えると、動画そのものが 413 で断られる。
  // 上限を触るときに気づけるよう関係を式で残す
  const extras =
    MAX_VIDEO_THUMB_BYTES + MAX_VIDEO_ANIM_FRAMES * MAX_VIDEO_ANIM_FRAME_BYTES

  expect(extras).toBeLessThan(MULTIPART_OVERHEAD_BYTES)
})

test('動画の上限は画像より大きい (docs/14: 3 分 720p を収める)', () => {
  // 3 分・映像 1Mbps + 音声 64kbps ≈ 24MB が収まること
  const estimatedThreeMin = ((1_000_000 + 64_000) / 8) * 180
  expect(estimatedThreeMin).toBeLessThan(MAX_VIDEO_BYTES)
})

test('isValidImageName は PDF 名を拾わない (一覧サムネ・画像検索に混ぜない)', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidImageName(`${uuid}.pdf`)).toBe(false)
})

test('isValidAttachmentName は PDF も許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidAttachmentName(`${uuid}.pdf`)).toBe(true)
  expect(isValidAttachmentName('../secret.pdf')).toBe(false)
})

function uploadRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/images', {
    method: 'POST',
    body: new FormData(),
    headers,
  })
}

test('Origin がないリクエスト (curl 等) は通す', () => {
  expect(checkUploadRequest(uploadRequest({ host: 'localhost' }))).toBeNull()
})

test('同一オリジンの POST は通す', () => {
  const request = uploadRequest({ origin: 'http://localhost', host: 'localhost' })
  expect(checkUploadRequest(request)).toBeNull()
})

test('クロスオリジンの POST は 403 で弾く (CSRF)', () => {
  const request = uploadRequest({
    origin: 'https://evil.example.com',
    host: 'localhost',
  })
  expect(checkUploadRequest(request)?.status).toBe(403)
})

test('Origin が壊れていても例外にせず 403 で弾く', () => {
  const request = uploadRequest({ origin: 'not-a-url', host: 'localhost' })
  expect(checkUploadRequest(request)?.status).toBe(403)
})

test('Content-Length が上限を超えていれば本文を読まず 413 で弾く', () => {
  const request = uploadRequest({
    host: 'localhost',
    'content-length': String(100 * 1024 * 1024),
  })
  expect(checkUploadRequest(request)?.status).toBe(413)
})

test('Content-Length が上限内なら通す', () => {
  const request = uploadRequest({
    host: 'localhost',
    'content-length': String(1024),
  })
  expect(checkUploadRequest(request)).toBeNull()
})

// --- テキスト系 (docs/12-添付ファイル種類拡張メモ.md) ---

test('テキストの保存名は UUID + txt/csv/md だけ許可する', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidTextName(`${uuid}.txt`)).toBe(true)
  expect(isValidTextName(`${uuid}.csv`)).toBe(true)
  expect(isValidTextName(`${uuid}.md`)).toBe(true)
  // 配信すると解釈されうる拡張子は保存名にしない (text/plain で配る前提が崩れる)
  expect(isValidTextName(`${uuid}.html`)).toBe(false)
  expect(isValidTextName(`${uuid}.svg`)).toBe(false)
  expect(isValidTextName('../../etc/passwd')).toBe(false)
  expect(isValidTextName('memo.txt')).toBe(false) // UUID 形式でない
})

test('テキストは配信ゲートを通るが、画像としては扱わない', () => {
  const uuid = '0f1e2d3c-4b5a-4678-9abc-def012345678'
  expect(isValidAttachmentName(`${uuid}.txt`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.csv`)).toBe(true)
  expect(isValidAttachmentName(`${uuid}.md`)).toBe(true)
  // 一覧サムネ・画像検索に混ぜない (音声・PDF と同じ線引き)
  expect(isValidImageName(`${uuid}.txt`)).toBe(false)
  expect(isValidImageName(`${uuid}.md`)).toBe(false)
})

test('テキストの配信 mime は charset つきの text/plain 系だけ', () => {
  expect(isAllowedContentMime('text/plain; charset=utf-8')).toBe(true)
  expect(isAllowedContentMime('text/csv; charset=utf-8')).toBe(true)
  expect(isAllowedContentMime('text/markdown; charset=utf-8')).toBe(true)
  // charset 無しは保存しないので採用しない (常に UTF-8 へ正規化してから保存する)
  expect(isAllowedContentMime('text/plain')).toBe(false)
  expect(isAllowedContentMime('text/html; charset=utf-8')).toBe(false)
})

test('元のファイル名から保存する mime / ext を決める (名前は保存名に使わない)', () => {
  expect(textSaveInfo('memo.md')).toEqual({
    mime: 'text/markdown; charset=utf-8',
    ext: 'md',
  })
  expect(textSaveInfo('売上.CSV')).toEqual({
    mime: 'text/csv; charset=utf-8',
    ext: 'csv',
  })
  expect(textSaveInfo('notes.txt')).toEqual({
    mime: 'text/plain; charset=utf-8',
    ext: 'txt',
  })
})

// **知らない拡張子は txt に倒さない。** テキストには署名が無く HTML も SVG も
// 「テキストとしては妥当」なので、名前でも名乗らせないと何でも通ってしまう
// (拡張子・MIME を偽装したものは弾く、という既存方針を保つ)
test('txt/csv/md 以外の名前はテキストとして受けない', () => {
  expect(textSaveInfo('evil.html')).toBeNull()
  expect(textSaveInfo('drawing.svg')).toBeNull()
  expect(textSaveInfo('archive.tar.gz')).toBeNull()
  expect(textSaveInfo('名前に拡張子が無い')).toBeNull()
  // 拡張子は「ドットのある末尾」だけ。名前そのものが csv でも拡張子ではない
  expect(textSaveInfo('csv')).toBeNull()
  expect(textSaveInfo(null)).toBeNull()
  expect(textSaveInfo(undefined)).toBeNull()
  expect(textSaveInfo('../../etc/passwd')).toBeNull()
})
