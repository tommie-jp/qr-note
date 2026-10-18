// JPEG から撮影情報の区画を抜く (docs/113-写真の撮影情報削除計画.md §3-1 / §3-7)。
//
// JPEG は SOI (FF D8) の後に「FF + 種類 + 長さ(2) + 中身」の区画が並び、SOS の
// 後ろはエントロピー符号化された画素、最後が EOI (FF D9)。画素の中に 0xFF が
// 現れるときは必ず 00 か RSTn (D0〜D7) が続くので、区画の境目は機械的に見分けられる。
//
// 残すもの: APP0 JFIF (縮小版は空にする)・APP2 ICC_PROFILE・APP14 Adobe・
// 復号に要る区画 (DQT / SOF / DHT / DRI / SOS …)・画素。
// 落とすもの: APP1 (Exif・XMP)・APP13 (IPTC)・その他の APPn・COM・EOI より後ろ。
// 向きは Exif から値だけ読み、向きだけを持つ最小 EXIF を書き戻す。

import {
  minimalExifTiff,
  needsOrientation,
  readExifFacts,
  withExifHeader,
  withoutExifHeader,
} from './tiff'
import {
  hasAsciiPrefix,
  type MetaKind,
  outcome,
  PhotoMetaFormatError,
  type StripOutcome,
} from './types'

const SOI = 0xd8
const EOI = 0xd9
const SOS = 0xda
const COM = 0xfe
const APP0 = 0xe0
const APP1 = 0xe1
const APP2 = 0xe2
const APP13 = 0xed
const APP14 = 0xee
const APP15 = 0xef

// JFIF の APP0 は縮小版を持たなければ中身 14 バイト (区画長 16)
const JFIF_BASE_PAYLOAD = 14

const XMP_IDS = ['http://ns.adobe.com/xap/1.0/\0', 'http://ns.adobe.com/xmp/extension/\0']

// 長さを持たない区画 (TEM と RSTn)
function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
}

function isApp(marker: number): boolean {
  return marker >= APP0 && marker <= APP15
}

function segment(marker: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = payload.byteLength + 2
  const out = new Uint8Array(length + 2)
  out.set([0xff, marker, length >> 8, length & 0xff], 0)
  out.set(payload, 4)
  return out
}

// SOS の後ろの画素を飛ばし、次の区画の先頭 (0xFF の位置) を返す。
// 見つからなければ末尾 (途中で切れた画像)
function nextMarkerAfterScan(input: Uint8Array, from: number): number {
  let at = from
  for (;;) {
    at = input.indexOf(0xff, at)
    if (at === -1 || at + 1 >= input.byteLength) {
      return input.byteLength
    }
    const next = input[at + 1]
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      at += 2 // 詰め物か RSTn。画素の続き
      continue
    }
    return at
  }
}

interface Collected {
  readonly removed: Set<MetaKind>
  orientation: number | null
}

// 区画 1 つの扱い:
//   'keep'     … そのまま残す
//   Uint8Array … 差し替えた区画を残す
//   null       … 落とす
type Verdict = 'keep' | Uint8Array | null

// APP0: JFIF だけ残す。縮小版 (古い写りが残りうる) は寸法 0 にして中身を捨てる
function keepApp0(payload: Uint8Array, collected: Collected): Verdict {
  if (!hasAsciiPrefix(payload, 'JFIF\0') || payload.byteLength < JFIF_BASE_PAYLOAD) {
    collected.removed.add('other')
    return null
  }
  const hasThumbnail =
    payload.byteLength > JFIF_BASE_PAYLOAD || payload[12] !== 0 || payload[13] !== 0
  if (!hasThumbnail) {
    return 'keep'
  }
  collected.removed.add('other')
  const base = payload.slice(0, JFIF_BASE_PAYLOAD)
  base[12] = 0
  base[13] = 0
  return segment(APP0, base)
}

// APP1: Exif は向きだけ控えて落とす。XMP も落とす
function dropApp1(payload: Uint8Array, collected: Collected): void {
  if (hasAsciiPrefix(payload, 'Exif\0\0')) {
    const facts = readExifFacts(withoutExifHeader(payload))
    collected.orientation ??= facts.orientation
    if (facts.gps) collected.removed.add('gps')
    if (facts.datetime) collected.removed.add('datetime')
    if (facts.camera) collected.removed.add('camera')
    if (!facts.onlyOrientation) collected.removed.add('exif')
    return
  }
  collected.removed.add(XMP_IDS.some((id) => hasAsciiPrefix(payload, id)) ? 'xmp' : 'other')
}

function keepSegment(marker: number, payload: Uint8Array, collected: Collected): Verdict {
  if (marker === COM) {
    collected.removed.add('comment')
    return null
  }
  if (!isApp(marker)) {
    return 'keep' // 復号に要る区画
  }
  switch (marker) {
    case APP0:
      return keepApp0(payload, collected)
    case APP1:
      dropApp1(payload, collected)
      return null
    case APP2:
      if (hasAsciiPrefix(payload, 'ICC_PROFILE\0')) {
        return 'keep'
      }
      break
    case APP13:
      collected.removed.add('iptc')
      return null
    case APP14:
      if (hasAsciiPrefix(payload, 'Adobe')) {
        return 'keep' // 色変換の指定。復号に要る
      }
      break
  }
  collected.removed.add('other')
  return null
}

export function stripJpeg(input: Uint8Array<ArrayBuffer>): StripOutcome {
  if (input.byteLength < 4 || input[0] !== 0xff || input[1] !== SOI) {
    throw new PhotoMetaFormatError('JPEG の先頭 (SOI) がありません')
  }
  const parts: Uint8Array[] = [input.subarray(0, 2)]
  const collected: Collected = { removed: new Set(), orientation: null }
  // 最小 EXIF を差し込む位置 (parts の添字)。SOI の直後、先頭が JFIF ならその直後
  let exifAt = 1
  let seenScan = false
  let at = 2

  while (at < input.byteLength) {
    if (input[at] !== 0xff) {
      throw new PhotoMetaFormatError(`区画の境目に 0xFF がありません (${at})`)
    }
    let markerAt = at
    while (markerAt + 1 < input.byteLength && input[markerAt + 1] === 0xff) {
      markerAt++ // 区画の前の詰め物
    }
    if (markerAt + 1 >= input.byteLength) {
      break
    }
    const marker = input[markerAt + 1]
    if (marker === EOI) {
      parts.push(input.subarray(markerAt, markerAt + 2))
      at = markerAt + 2
      break
    }
    if (isStandalone(marker)) {
      parts.push(input.subarray(markerAt, markerAt + 2))
      at = markerAt + 2
      continue
    }
    if (markerAt + 4 > input.byteLength) {
      throw new PhotoMetaFormatError('区画の長さが読めません')
    }
    const length = (input[markerAt + 2] << 8) | input[markerAt + 3]
    const end = markerAt + 2 + length
    if (length < 2 || end > input.byteLength) {
      throw new PhotoMetaFormatError(`区画の長さが不正です (${length})`)
    }

    const kept = keepSegment(marker, input.subarray(markerAt + 4, end), collected)
    if (kept !== null) {
      parts.push(kept === 'keep' ? input.subarray(markerAt, end) : kept)
      if (marker === APP0 && parts.length === 2) {
        exifAt = 2
      }
    }
    at = end

    if (marker === SOS) {
      seenScan = true
      const next = nextMarkerAfterScan(input, at)
      parts.push(input.subarray(at, next))
      at = next
    }
  }

  if (!seenScan) {
    throw new PhotoMetaFormatError('画素 (SOS) に届く前に終わっています')
  }
  if (at < input.byteLength) {
    collected.removed.add('trailer')
  }
  const withOrientation = needsOrientation(collected.orientation)
    ? [
        ...parts.slice(0, exifAt),
        segment(APP1, withExifHeader(minimalExifTiff(collected.orientation))),
        ...parts.slice(exifAt),
      ]
    : parts
  return outcome(input, withOrientation, collected.removed)
}
