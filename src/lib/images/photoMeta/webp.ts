// WebP から撮影情報の区画を抜く (docs/113-写真の撮影情報削除計画.md §3-3)。
//
// WebP は RIFF: "RIFF" + 全体の長さ(4, LE) + "WEBP" の後に「FourCC(4) + 長さ(4, LE)
// + 中身 (+ 奇数なら詰め物 1 バイト)」の区画が並ぶ。付帯情報を持てるのは拡張形式
// (先頭が VP8X) だけで、VP8X の 1 バイト目の印が EXIF・XMP の有無を言う。
//
// 落とすもの: EXIF・"XMP "・RIFF の長さより後ろ。
// 残すもの: VP8X (印は直す)・ICCP・ANIM / ANMF・VP8 / VP8L・ALPH・知らない区画。
// 向きは EXIF から値だけ読み、向きだけを持つ EXIF を末尾に書き戻す
// (仕様上 EXIF は画像データの後ろに置く)。

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

const FLAG_EXIF = 0x08
const FLAG_XMP = 0x04
const IMAGE_CHUNKS = new Set(['VP8 ', 'VP8L', 'ANMF'])
const LATIN1 = new TextDecoder('latin1')

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const padded = data.byteLength + (data.byteLength & 1)
  const out = new Uint8Array(8 + padded)
  out.set(new TextEncoder().encode(fourcc), 0)
  new DataView(out.buffer).setUint32(4, data.byteLength, true)
  out.set(data, 8)
  return out
}

function riffHeader(bodyLength: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12)
  out.set(new TextEncoder().encode('RIFF'), 0)
  new DataView(out.buffer).setUint32(4, bodyLength + 4, true)
  out.set(new TextEncoder().encode('WEBP'), 8)
  return out
}

// VP8X の印を付け直した写し (入力は書き換えない)
function withFlags(vp8x: Uint8Array, addExif: boolean): Uint8Array<ArrayBuffer> {
  const copy = vp8x.slice()
  copy[8] = (copy[8] & ~(FLAG_EXIF | FLAG_XMP)) | (addExif ? FLAG_EXIF : 0)
  return copy
}

export function stripWebp(input: Uint8Array<ArrayBuffer>): StripOutcome {
  if (!hasAsciiPrefix(input, 'RIFF') || !hasAsciiPrefix(input, 'WEBP', 8)) {
    throw new PhotoMetaFormatError('WebP (RIFF / WEBP) の印がありません')
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const riffEnd = 8 + view.getUint32(4, true)
  if (riffEnd > input.byteLength) {
    throw new PhotoMetaFormatError('RIFF の長さが末尾を越えています')
  }

  const chunks: Uint8Array[] = []
  const removed = new Set<MetaKind>()
  let orientation: number | null = null
  let vp8xIndex = -1
  let hasImage = false
  let at = 12

  while (at + 8 <= riffEnd) {
    const fourcc = LATIN1.decode(input.subarray(at, at + 4))
    const size = view.getUint32(at + 4, true)
    const dataEnd = at + 8 + size
    if (dataEnd > riffEnd) {
      throw new PhotoMetaFormatError(`区画の長さが RIFF の外へ出ています (${fourcc})`)
    }
    // 奇数長の詰め物。最後の区画で詰め物を省く書き手もいるので RIFF の端で止める
    const end = Math.min(dataEnd + (size & 1), riffEnd)
    const data = input.subarray(at + 8, dataEnd)

    if (fourcc === 'EXIF') {
      const facts = readExifFacts(withoutExifHeader(data))
      orientation ??= facts.orientation
      if (facts.gps) removed.add('gps')
      if (facts.datetime) removed.add('datetime')
      if (facts.camera) removed.add('camera')
      if (!facts.onlyOrientation) removed.add('exif')
    } else if (fourcc === 'XMP ') {
      removed.add('xmp')
    } else {
      if (fourcc === 'VP8X' && vp8xIndex === -1) {
        vp8xIndex = chunks.length
      }
      hasImage ||= IMAGE_CHUNKS.has(fourcc)
      chunks.push(input.subarray(at, end))
    }
    at = end
  }

  if (!hasImage) {
    throw new PhotoMetaFormatError('画像の区画 (VP8 / VP8L / ANMF) がありません')
  }
  if (riffEnd < input.byteLength) {
    removed.add('trailer')
  }

  // 向きは拡張形式でしか持てない。EXIF があった時点で VP8X はあるはず
  const addExif = needsOrientation(orientation) && vp8xIndex !== -1
  const body = [
    ...chunks.map((chunk, i) => (i === vp8xIndex ? withFlags(chunk, addExif) : chunk)),
    ...(addExif && orientation !== null
      ? [riffChunk('EXIF', withExifHeader(minimalExifTiff(orientation)))]
      : []),
  ]
  const bodyLength = body.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  return outcome(input, [riffHeader(bodyLength), ...body], removed)
}
