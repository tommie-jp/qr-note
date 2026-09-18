// PNG から撮影情報の区画を抜く (docs/97-写真の撮影情報削除計画.md §3-2)。
//
// PNG は署名 8 バイトの後に「長さ(4) + 種類(4) + 中身 + CRC(4)」の区画が並び、
// IEND で終わる。落とすのは付帯情報の区画だけで、画素 (IDAT) と表示に要る区画
// (IHDR・PLTE・iCCP・gAMA・APNG のコマ …) はそのまま残す。
//
// 落とすもの: eXIf・tEXt / zTXt / iTXt (作者・XMP・ImageMagick の Raw profile)・
// tIME・dSIG・caBX (C2PA)・IEND より後ろ。
// 向きは eXIf から値だけ読み、向きだけを持つ eXIf を IHDR の直後に書き戻す。
//
// **Apple の iDOT に気を付ける。** Apple の書き出す PNG は IDAT の直前に iDOT を
// 置き、分割して復号するための IDAT の位置を iDOT の先頭からの距離で持つ。
// iDOT と IDAT の間で区画を足し引きするとこの距離がずれ、Apple の復号器が絵を
// 崩す。書き戻す eXIf は IHDR の直後 (iDOT より前) に置き、iDOT と IDAT の間の
// 区画を落としたときは iDOT も落とす (無くても順に復号されるだけ)。

import { crc32 } from 'node:zlib'
import { minimalExifTiff, needsOrientation, readExifFacts, withoutExifHeader } from './tiff'
import {
  concatBytes,
  type MetaKind,
  outcome,
  PhotoMetaFormatError,
  type StripOutcome,
} from './types'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const TEXT_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt'])
const OTHER_CHUNKS = new Set(['tIME', 'dSIG', 'caBX'])
// 区画の枠 (長さ + 種類 + CRC)
const CHUNK_OVERHEAD = 12

const LATIN1 = new TextDecoder('latin1')

// 文字の区画の中身は「キーワード\0 …」。キーワードで何の情報かが分かる
function textKind(data: Uint8Array): MetaKind {
  const end = data.indexOf(0)
  const keyword = LATIN1.decode(data.subarray(0, end === -1 ? data.byteLength : end))
  if (keyword === 'XML:com.adobe.xmp') {
    return 'xmp'
  }
  // ImageMagick は EXIF や IPTC を「Raw profile type exif」などの名前で 16 進の文字にして持つ
  const raw = /^Raw profile type (\w+)$/.exec(keyword)?.[1]?.toLowerCase()
  if (raw === 'exif' || raw === 'app1') {
    return 'exif'
  }
  if (raw === 'iptc' || raw === '8bim') {
    return 'iptc'
  }
  if (raw === 'xmp') {
    return 'xmp'
  }
  return raw === undefined ? 'comment' : 'other'
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const typeAndData = concatBytes([new TextEncoder().encode(type), data])
  const out = new Uint8Array(data.byteLength + CHUNK_OVERHEAD)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.byteLength)
  out.set(typeAndData, 4)
  view.setUint32(out.byteLength - 4, crc32(typeAndData))
  return out
}

export function stripPng(input: Uint8Array<ArrayBuffer>): StripOutcome {
  if (!SIGNATURE.every((byte, i) => input[i] === byte)) {
    throw new PhotoMetaFormatError('PNG の署名がありません')
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const parts: Uint8Array[] = [input.subarray(0, SIGNATURE.length)]
  const removed = new Set<MetaKind>()
  let orientation: number | null = null
  // IHDR の直後の parts 上の位置。eXIf はここに書き戻す
  let afterIhdr = -1
  // iDOT の parts 上の位置と、iDOT と IDAT の間で区画を落としたか
  let idot = -1
  let droppedAfterIdot = false
  let seenIdat = false
  let ended = false
  let at = SIGNATURE.length

  while (at + CHUNK_OVERHEAD <= input.byteLength) {
    const length = view.getUint32(at)
    const end = at + CHUNK_OVERHEAD + length
    if (end > input.byteLength) {
      throw new PhotoMetaFormatError(`区画の長さが末尾を越えています (${length})`)
    }
    const type = LATIN1.decode(input.subarray(at + 4, at + 8))
    const data = input.subarray(at + 8, at + 8 + length)
    const partsBefore = parts.length
    if (afterIhdr === -1 && type !== 'IHDR') {
      throw new PhotoMetaFormatError('先頭の区画が IHDR ではありません')
    }

    if (type === 'eXIf') {
      const facts = readExifFacts(withoutExifHeader(data))
      orientation ??= facts.orientation
      if (facts.gps) removed.add('gps')
      if (facts.datetime) removed.add('datetime')
      if (facts.camera) removed.add('camera')
      if (!facts.onlyOrientation) removed.add('exif')
    } else if (TEXT_CHUNKS.has(type)) {
      removed.add(textKind(data))
    } else if (OTHER_CHUNKS.has(type)) {
      removed.add('other')
    } else {
      if (type === 'iDOT' && idot === -1) {
        idot = parts.length
      }
      seenIdat ||= type === 'IDAT'
      parts.push(input.subarray(at, end))
      if (type === 'IHDR') {
        afterIhdr = parts.length
      }
    }
    if (parts.length === partsBefore && idot !== -1 && !seenIdat) {
      droppedAfterIdot = true
    }
    at = end
    if (type === 'IEND') {
      ended = true
      break
    }
  }

  if (!ended) {
    throw new PhotoMetaFormatError('IEND に届く前に終わっています')
  }
  if (!seenIdat) {
    throw new PhotoMetaFormatError('画素 (IDAT) がありません')
  }
  if (at < input.byteLength) {
    removed.add('trailer')
  }
  if (droppedAfterIdot) {
    removed.add('other')
  }
  const kept = droppedAfterIdot ? parts.filter((_, i) => i !== idot) : parts
  // iDOT を落としても afterIhdr より前 (IHDR は先頭) なので位置は変わらない
  const withOrientation = needsOrientation(orientation)
    ? [
        ...kept.slice(0, afterIhdr),
        pngChunk('eXIf', minimalExifTiff(orientation)),
        ...kept.slice(afterIhdr),
      ]
    : kept
  return outcome(input, withOrientation, removed)
}
