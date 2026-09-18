// AVIF から撮影情報を消す (docs/97-写真の撮影情報削除計画.md §3-5)。
//
// AVIF (HEIF) は ISO-BMFF の箱の入れ子で、Exif や XMP は画像と並ぶ「アイテム」
// として持つ。meta 箱の iinf が各アイテムの種類を、iloc が中身の位置を言う。
// 位置は箱の外 (mdat) や idat 箱の中を指すので、区画を抜くと位置の表を全部
// 書き直すことになる。そこで**箱の並びは変えず、中身だけを 0 で埋める**。
//
// 向きは Exif ではなく irot / imir (変形の属性) で持つので、Exif を消しても変わらない。

import { readExifFacts } from './tiff'
import { type MetaKind, outcome, PhotoMetaFormatError, type StripOutcome } from './types'

interface Box {
  readonly type: string
  readonly start: number
  // 中身の始まり (箱の頭の直後)
  readonly bodyAt: number
  readonly end: number
}

interface Extent {
  readonly offset: number
  readonly length: number
}

interface ItemLocation {
  // 0: ファイル先頭からの位置 / 1: idat 箱の中の位置 / 2: 別アイテムへの参照
  readonly method: number
  readonly extents: readonly Extent[]
}

const LATIN1 = new TextDecoder('latin1')

// 位置表 (iloc) の区間の総数の上限。値の長さの欄はすべて 0 バイトにできるので、
// 1 区間あたり 1 バイトも読まずに回る。上限が無いと数 KB のファイルで
// 件数 × 区間数 (最大 65535) の周回を強いられる。実物の AVIF は区間が数個〜
// タイル数ぶん (多くて数百) なので、この上限に届くことはない
const MAX_ILOC_EXTENTS = 1 << 16

function boxesIn(view: DataView, bytes: Uint8Array, from: number, to: number): Box[] {
  const boxes: Box[] = []
  let at = from
  while (at + 8 <= to) {
    let size = view.getUint32(at)
    let bodyAt = at + 8
    if (size === 1) {
      if (at + 16 > to) {
        throw new PhotoMetaFormatError('64 ビット長の箱が途中で終わっています')
      }
      size = Number(view.getBigUint64(at + 8))
      bodyAt = at + 16
    } else if (size === 0) {
      size = to - at // 親の終わりまで
    }
    const end = at + size
    if (end > to || end < bodyAt) {
      throw new PhotoMetaFormatError(`箱の長さが不正です (${size})`)
    }
    boxes.push({ type: LATIN1.decode(bytes.subarray(at + 4, at + 8)), start: at, bodyAt, end })
    at = end
  }
  return boxes
}

// 範囲を検査しながら前から読む
class Cursor {
  constructor(
    private readonly view: DataView,
    public at: number,
    private readonly end: number,
  ) {}

  private need(size: number): void {
    if (this.at + size > this.end) {
      throw new PhotoMetaFormatError('箱の中身が途中で終わっています')
    }
  }

  u8(): number {
    this.need(1)
    return this.view.getUint8(this.at++)
  }

  u16(): number {
    this.need(2)
    const value = this.view.getUint16(this.at)
    this.at += 2
    return value
  }

  u32(): number {
    this.need(4)
    const value = this.view.getUint32(this.at)
    this.at += 4
    return value
  }

  // iloc の可変長の値 (0 / 4 / 8 バイト)
  sized(size: number): number {
    if (size === 0) return 0
    if (size === 4) return this.u32()
    if (size === 8) {
      this.need(8)
      const value = Number(this.view.getBigUint64(this.at))
      this.at += 8
      return value
    }
    throw new PhotoMetaFormatError(`iloc の値の長さが不正です (${size})`)
  }

  cString(): string {
    const from = this.at
    while (this.at < this.end && this.view.getUint8(this.at) !== 0) {
      this.at++
    }
    const text = LATIN1.decode(
      new Uint8Array(this.view.buffer, this.view.byteOffset + from, this.at - from),
    )
    this.at = Math.min(this.at + 1, this.end)
    return text
  }
}

// iinf: 消す対象 (Exif と XMP) のアイテム番号 → 種類
function readTargets(view: DataView, bytes: Uint8Array, iinf: Box): Map<number, MetaKind> {
  const cursor = new Cursor(view, iinf.bodyAt, iinf.end)
  const version = cursor.u8()
  cursor.at += 3 // flags
  if (version === 0) cursor.u16()
  else cursor.u32()
  const targets = new Map<number, MetaKind>()
  for (const infe of boxesIn(view, bytes, cursor.at, iinf.end)) {
    if (infe.type !== 'infe') {
      continue
    }
    const entry = new Cursor(view, infe.bodyAt, infe.end)
    const infeVersion = entry.u8()
    entry.at += 3
    if (infeVersion < 2) {
      continue // 種類を持たない古い形。画像のアイテムには使われない
    }
    const id = infeVersion === 2 ? entry.u16() : entry.u32()
    entry.u16() // protection index
    const itemType = LATIN1.decode(bytes.subarray(entry.at, entry.at + 4))
    entry.at += 4
    entry.cString() // item name
    if (itemType === 'Exif') {
      targets.set(id, 'exif')
    } else if (itemType === 'mime' && entry.cString() === 'application/rdf+xml') {
      targets.set(id, 'xmp')
    }
  }
  return targets
}

// iloc: 消す対象のアイテム番号 → 位置 (対象でないアイテムは読み飛ばすだけ)
function readLocations(
  view: DataView,
  iloc: Box,
  targets: ReadonlyMap<number, MetaKind>,
): Map<number, ItemLocation> {
  const cursor = new Cursor(view, iloc.bodyAt, iloc.end)
  const version = cursor.u8()
  cursor.at += 3
  const sizes = cursor.u8()
  const baseAndIndex = cursor.u8()
  const offsetSize = sizes >> 4
  const lengthSize = sizes & 0x0f
  const baseOffsetSize = baseAndIndex >> 4
  const indexSize = version === 1 || version === 2 ? baseAndIndex & 0x0f : 0
  const itemCount = version < 2 ? cursor.u16() : cursor.u32()
  const locations = new Map<number, ItemLocation>()
  let totalExtents = 0
  for (let i = 0; i < itemCount; i++) {
    const id = version < 2 ? cursor.u16() : cursor.u32()
    const method = version === 1 || version === 2 ? cursor.u16() & 0x0f : 0
    cursor.u16() // data reference index
    const base = cursor.sized(baseOffsetSize)
    const extentCount = cursor.u16()
    totalExtents += extentCount
    if (totalExtents > MAX_ILOC_EXTENTS) {
      throw new PhotoMetaFormatError(`iloc の区間が多すぎます (${totalExtents})`)
    }
    const wanted = targets.has(id)
    const extents: Extent[] = []
    for (let j = 0; j < extentCount; j++) {
      cursor.sized(indexSize)
      const offset = base + cursor.sized(offsetSize)
      const length = cursor.sized(lengthSize)
      if (wanted) {
        extents.push({ offset, length })
      }
    }
    if (wanted) {
      locations.set(id, { method, extents })
    }
  }
  return locations
}

// アイテムの中身の範囲 (ファイル先頭からの位置)
function extentRanges(location: ItemLocation, idat: Box | undefined, fileEnd: number): Extent[] {
  if (location.method !== 0 && location.method !== 1) {
    throw new PhotoMetaFormatError(`扱えない位置の指定です (method ${location.method})`)
  }
  const base = location.method === 0 ? 0 : idat?.bodyAt
  const limit = location.method === 0 ? fileEnd : idat?.end
  if (base === undefined || limit === undefined) {
    throw new PhotoMetaFormatError('idat 箱がありません')
  }
  return location.extents.map(({ offset, length }) => {
    const start = base + offset
    if (length === 0 || start + length > limit) {
      throw new PhotoMetaFormatError('アイテムの位置が範囲の外です')
    }
    return { offset: start, length }
  })
}

// Exif アイテムの中身は「TIFF までの距離(4) + … + TIFF」
function exifFacts(data: Uint8Array) {
  if (data.byteLength < 4) {
    return null
  }
  const skip = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0)
  return readExifFacts(data.subarray(Math.min(4 + skip, data.byteLength)))
}

export function stripAvif(input: Uint8Array<ArrayBuffer>): StripOutcome {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const meta = boxesIn(view, input, 0, input.byteLength).find((box) => box.type === 'meta')
  if (!meta) {
    return { bytes: input, removed: new Set() }
  }
  // meta は FullBox (版と印の 4 バイトが先に来る)
  const children = boxesIn(view, input, meta.bodyAt + 4, meta.end)
  const iinf = children.find((box) => box.type === 'iinf')
  const iloc = children.find((box) => box.type === 'iloc')
  const idat = children.find((box) => box.type === 'idat')
  if (!iinf) {
    return { bytes: input, removed: new Set() }
  }
  const targets = readTargets(view, input, iinf)
  if (targets.size === 0) {
    return { bytes: input, removed: new Set() }
  }
  if (!iloc) {
    throw new PhotoMetaFormatError('iloc 箱がありません')
  }
  const locations = readLocations(view, iloc, targets)
  const out = input.slice()
  const removed = new Set<MetaKind>()
  for (const [id, kind] of targets) {
    const location = locations.get(id)
    if (!location) {
      throw new PhotoMetaFormatError(`アイテム ${id} の位置がありません`)
    }
    for (const { offset, length } of extentRanges(location, idat, input.byteLength)) {
      const data = input.subarray(offset, offset + length)
      if (data.every((byte) => byte === 0)) {
        continue // 消し済み
      }
      removed.add(kind)
      if (kind === 'exif') {
        const facts = exifFacts(data)
        if (facts?.gps) removed.add('gps')
        if (facts?.datetime) removed.add('datetime')
        if (facts?.camera) removed.add('camera')
      }
      out.fill(0, offset, offset + length)
    }
  }
  return outcome(input, [out], removed)
}
