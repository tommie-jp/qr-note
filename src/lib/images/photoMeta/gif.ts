// GIF から付帯情報の区画を抜く (docs/97-写真の撮影情報削除計画.md §3-4)。
//
// GIF は「署名(6) + 画面の記述(7) + 大域の色表」の後に、拡張 (0x21) と画像 (0x2C) の
// 区画が並び、0x3B で終わる。区画の中身は「長さ(1) + 中身」の小区画の並びで、
// 長さ 0 で閉じる。GIF は EXIF を持てないので、写真の撮影情報はまず入らない。
// 落とすのは文字で持てる付帯情報だけ。
//
// 落とすもの: コメント拡張・XMP / Photoshop などのアプリ拡張・知らない拡張・終端より後ろ。
// 残すもの: 画像・描画制御 (0xF9)・プレーンテキスト (0x01)・ループ指定
// (NETSCAPE2.0 / ANIMEXTS1.0)・色の指定 (ICCRGBG1012)。

import { hasAsciiPrefix, type MetaKind, outcome, PhotoMetaFormatError, type StripOutcome } from './types'

const EXTENSION = 0x21
const IMAGE = 0x2c
const TRAILER = 0x3b
const LABEL_GRAPHIC_CONTROL = 0xf9
const LABEL_PLAIN_TEXT = 0x01
const LABEL_COMMENT = 0xfe
const LABEL_APPLICATION = 0xff
const APP_ID_LENGTH = 11
const KEEP_APPS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0', 'ICCRGBG1012'])
const LATIN1 = new TextDecoder('latin1')

// 色表の大きさ (印の下位 3 ビットが 2 の何乗か)。表が無ければ 0
function colorTableSize(packed: number): number {
  return packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0
}

// 小区画の並びを飛ばし、閉じの 0 の次の位置を返す
function skipSubBlocks(input: Uint8Array, from: number): number {
  let at = from
  while (at < input.byteLength) {
    const size = input[at]
    if (size === 0) {
      return at + 1
    }
    at += 1 + size
  }
  throw new PhotoMetaFormatError('小区画の途中で終わっています')
}

// 拡張の扱い。null なら残す
function extensionKind(input: Uint8Array, at: number): MetaKind | null {
  const label = input[at + 1]
  if (label === LABEL_GRAPHIC_CONTROL || label === LABEL_PLAIN_TEXT) {
    return null
  }
  if (label === LABEL_COMMENT) {
    return 'comment'
  }
  if (label === LABEL_APPLICATION && input[at + 2] === APP_ID_LENGTH) {
    const id = LATIN1.decode(input.subarray(at + 3, at + 3 + APP_ID_LENGTH))
    if (KEEP_APPS.has(id)) {
      return null
    }
    return id === 'XMP DataXMP' ? 'xmp' : 'other'
  }
  return 'other'
}

export function stripGif(input: Uint8Array<ArrayBuffer>): StripOutcome {
  if (!hasAsciiPrefix(input, 'GIF87a') && !hasAsciiPrefix(input, 'GIF89a')) {
    throw new PhotoMetaFormatError('GIF の署名がありません')
  }
  if (input.byteLength < 13) {
    throw new PhotoMetaFormatError('画面の記述が足りません')
  }
  const headerEnd = 13 + colorTableSize(input[10])
  if (headerEnd > input.byteLength) {
    throw new PhotoMetaFormatError('大域の色表が途中で終わっています')
  }
  const parts: Uint8Array[] = [input.subarray(0, headerEnd)]
  const removed = new Set<MetaKind>()
  let ended = false
  let at = headerEnd

  while (at < input.byteLength) {
    const introducer = input[at]
    if (introducer === TRAILER) {
      parts.push(input.subarray(at, at + 1))
      at += 1
      ended = true
      break
    }
    if (introducer === EXTENSION) {
      const end = skipSubBlocks(input, at + 2)
      const kind = extensionKind(input, at)
      if (kind === null) {
        parts.push(input.subarray(at, end))
      } else {
        removed.add(kind)
      }
      at = end
      continue
    }
    if (introducer === IMAGE) {
      if (at + 10 > input.byteLength) {
        throw new PhotoMetaFormatError('画像の記述が途中で終わっています')
      }
      // 画像の記述(10) + 局所の色表 + LZW の最小符号長(1) の後に小区画
      const dataAt = at + 10 + colorTableSize(input[at + 9]) + 1
      const end = skipSubBlocks(input, dataAt)
      parts.push(input.subarray(at, end))
      at = end
      continue
    }
    throw new PhotoMetaFormatError(`知らない区画の印です (0x${introducer.toString(16)})`)
  }

  if (!ended) {
    throw new PhotoMetaFormatError('終端 (0x3B) に届く前に終わっています')
  }
  if (at < input.byteLength) {
    removed.add('trailer')
  }
  return outcome(input, parts, removed)
}
