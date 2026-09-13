// 形式判定のテストが共有する最小のバイト列 (判定に要る先頭だけを模す)。
// sniff/ の画像・音声・動画・PDF の各テストから使う。

export const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])

// ISO-BMFF (HEIC/AVIF) の ftyp ボックスを手で組む。
// 構造: size(4) + "ftyp"(4) + major brand(4) + minor version(4) + compatible brands(4*n)
export function ftypBox(major: string, compatible: string[]): Uint8Array {
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

// ISO-BMFF の汎用ボックス [長さ(4)][型(4)][中身]。
export function box(type: string, payload: Uint8Array): Uint8Array {
  const enc = new TextEncoder()
  const buf = new Uint8Array(8 + payload.byteLength)
  new DataView(buf.buffer).setUint32(0, buf.byteLength)
  buf.set(enc.encode(type), 4)
  buf.set(payload, 8)
  return buf
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

// hdlr ボックス。中身は version+flags(4) → pre_defined(4) → handler(4) → 予備。
export function hdlrBox(handler: string): Uint8Array {
  const payload = new Uint8Array(25)
  payload.set(new TextEncoder().encode(handler), 8)
  return box('hdlr', payload)
}

// ftyp + moov(trak(mdia(hdlr))) の最小 mp4。ハンドラ種別ごとに trak を作る。
export function mp4WithHandlers(major: string, handlers: string[]): Uint8Array {
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
export function webmFile(codecIds: string[], padding = 0): Uint8Array {
  const enc = new TextEncoder()
  return concatBytes([
    Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]),
    new Uint8Array(padding),
    ...codecIds.map((id) => enc.encode(id)),
  ])
}
