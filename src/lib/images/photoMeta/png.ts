// PNG から撮影情報の区画を抜く (docs/113-写真の撮影情報削除計画.md §3-2)。
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

import { pushSlice } from './parts'
import { crc32 } from 'node:zlib'
import {
  minimalExifTiff,
  needsOrientation,
  readExifFacts,
  recordExifFacts,
  withoutExifHeader,
} from './tiff'
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

// 区画を読み進める間の状態。parts と removed は stripPng が持ち、ここで積む
interface PngScan {
  readonly input: Uint8Array<ArrayBuffer>
  readonly parts: Uint8Array[]
  readonly removed: Set<MetaKind>
  orientation: number | null
  // IHDR の直後の parts 上の位置。eXIf はここに書き戻す
  afterIhdr: number
  // iDOT の parts 上の位置と、iDOT と IDAT の間で区画を落としたか
  idot: number
  droppedAfterIdot: boolean
  seenIdat: boolean
}

interface PngChunk {
  readonly type: string
  readonly data: Uint8Array
  readonly end: number
}

function readChunk(input: Uint8Array, view: DataView, at: number): PngChunk {
  const length = view.getUint32(at)
  const end = at + CHUNK_OVERHEAD + length
  if (end > input.byteLength) {
    throw new PhotoMetaFormatError(`区画の長さが末尾を越えています (${length})`)
  }
  return {
    type: LATIN1.decode(input.subarray(at + 4, at + 8)),
    data: input.subarray(at + 8, at + 8 + length),
    end,
  }
}

// 付帯情報の区画なら抜いた種類を記録して true (落とす) を返す
function dropMetaChunk(scan: PngScan, { type, data }: PngChunk): boolean {
  if (type === 'eXIf') {
    const facts = readExifFacts(withoutExifHeader(data))
    scan.orientation ??= facts.orientation
    recordExifFacts(scan.removed, facts)
    return true
  }
  if (TEXT_CHUNKS.has(type)) {
    scan.removed.add(textKind(data))
    return true
  }
  if (OTHER_CHUNKS.has(type)) {
    scan.removed.add('other')
    return true
  }
  return false
}

function keepChunk(scan: PngScan, type: string, at: number, end: number): void {
  const { input, parts } = scan
  scan.seenIdat ||= type === 'IDAT'
  // 残す区画は連続する切れ端として伸ばす (parts.ts。2026-11 の監査 M-9)。
  // ただし **IHDR と iDOT は添字で覚える**ので、それ自体を 1 要素として置き、
  // 直後に長さ 0 の切れ端を挟んで、次の区画がそこへ伸びるようにする
  // (eXIf の書き戻しは afterIhdr の位置へ、iDOT の除去は idot の要素だけ)
  if (type === 'IHDR') {
    parts.push(input.subarray(at, end), input.subarray(end, end))
    scan.afterIhdr = parts.length - 1
  } else if (type === 'iDOT' && scan.idot === -1) {
    scan.idot = parts.length
    parts.push(input.subarray(at, end), input.subarray(end, end))
  } else {
    pushSlice(parts, input, at, end)
  }
}

// IEND まで区画を読み、読み終えた位置を返す
function scanChunks(scan: PngScan): number {
  const { input } = scan
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  let at = SIGNATURE.length
  while (at + CHUNK_OVERHEAD <= input.byteLength) {
    const chunk = readChunk(input, view, at)
    if (scan.afterIhdr === -1 && chunk.type !== 'IHDR') {
      throw new PhotoMetaFormatError('先頭の区画が IHDR ではありません')
    }
    const dropped = dropMetaChunk(scan, chunk)
    if (!dropped) {
      keepChunk(scan, chunk.type, at, chunk.end)
    }
    if (dropped && scan.idot !== -1 && !scan.seenIdat) {
      scan.droppedAfterIdot = true
    }
    at = chunk.end
    if (chunk.type === 'IEND') {
      return at
    }
  }
  throw new PhotoMetaFormatError('IEND に届く前に終わっています')
}

export function stripPng(input: Uint8Array<ArrayBuffer>): StripOutcome {
  if (!SIGNATURE.every((byte, i) => input[i] === byte)) {
    throw new PhotoMetaFormatError('PNG の署名がありません')
  }
  const scan: PngScan = {
    input,
    parts: [input.subarray(0, SIGNATURE.length)],
    removed: new Set<MetaKind>(),
    orientation: null,
    afterIhdr: -1,
    idot: -1,
    droppedAfterIdot: false,
    seenIdat: false,
  }
  const at = scanChunks(scan)
  const { parts, removed, orientation, afterIhdr, idot, droppedAfterIdot } = scan

  if (!scan.seenIdat) {
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
