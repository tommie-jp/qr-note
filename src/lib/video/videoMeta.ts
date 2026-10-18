// MP4 / MOV から撮影情報 (位置・日時・機種など) を消す
// (docs/113-写真の撮影情報削除計画.md §10)。
//
// 動画は ISO-BMFF の箱の入れ子で、撮影情報は次の場所にある:
//   moov/udta        … ©xyz (位置)・©mak / ©mod (機種)・©day (日時)。Android・ffmpeg
//   moov/meta        … keys + ilst。iPhone は com.apple.quicktime.location.ISO6709・
//                      make・model・creationdate をここに持つ
//   trak/udta・meta  … トラック単位の同じもの
//   uuid (XMP)       … Adobe 系の書き出し
//   mvhd/tkhd/mdhd   … 作成・更新の日時 (1904 年起点の秒)
//
// 画素や音 (mdat) の位置は stco / co64 に**ファイル先頭からの絶対位置**で書かれて
// いるので、箱を抜いて詰めると位置表を全部直すことになる (video/mp4Faststart.ts が
// moov を動かすときにやっている作業)。そこで**箱の長さは変えず、型を free に
// 替えて中身を 0 で埋める**。再生側は free を読み飛ばすので、位置表は 1 つも
// ずれない。日時の欄は 0 を書く。
//
// 扱わないもの: 時刻付きのメタデータのトラック (ドローンの飛行記録など)。
// 値が mdat の標本に入っていて、消すにはトラックごと落とすことになる。

import {
  type MetaKind,
  PhotoMetaFormatError,
  type StripOutcome,
} from '@/lib/images/photoMeta/types'

interface Box {
  readonly type: string
  readonly start: number
  readonly bodyAt: number
  readonly end: number
}

// 撮影情報を探して降りる入れ子。stbl より下には無い
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf'])
const TIMED_HEADERS = new Set(['mvhd', 'tkhd', 'mdhd'])
const XMP_UUID = [
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
]
// 入れ子の深さの上限。実物は moov > trak > mdia > minf の 4 段。上限が無いと
// trak を数千段重ねた細工ファイルでスタックが溢れる
const MAX_DEPTH = 16
const FREE = new TextEncoder().encode('free')
const LATIN1 = new TextDecoder('latin1')

// 並びを読む。strict なら壊れた長さ・端数で例外、そうでなければ読めたところまで返す
// (QuickTime の udta は最後に 0 の 4 バイトを置く書き手がある)
function readBoxes(bytes: Uint8Array, from: number, to: number, strict: boolean): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const boxes: Box[] = []
  let at = from
  while (at + 8 <= to) {
    let size = view.getUint32(at)
    let bodyAt = at + 8
    if (size === 1) {
      if (at + 16 > to) break
      size = Number(view.getBigUint64(at + 8))
      bodyAt = at + 16
    } else if (size === 0) {
      size = to - at
    }
    if (size < bodyAt - at || at + size > to) {
      break
    }
    boxes.push({ type: LATIN1.decode(bytes.subarray(at + 4, at + 8)), start: at, bodyAt, end: at + size })
    at += size
  }
  if (strict && at !== to) {
    throw new PhotoMetaFormatError(`箱の並びが途中で崩れています (${at} / ${to})`)
  }
  return boxes
}

function isXmpUuid(bytes: Uint8Array, box: Box): boolean {
  return box.type === 'uuid' && XMP_UUID.every((byte, i) => bytes[box.bodyAt + i] === byte)
}

// 鍵の名前 (com.apple.quicktime.location.ISO6709 など) が何の情報か
function keyKind(key: string): MetaKind {
  const lower = key.toLowerCase()
  if (lower.includes('location')) return 'gps'
  if (lower.endsWith('.make') || lower.endsWith('.model')) return 'camera'
  if (lower.includes('creationdate')) return 'datetime'
  return 'other'
}

// udta / ilst の子の型 (©xyz など) が何の情報か
function atomKind(type: string): MetaKind {
  switch (type) {
    case '©xyz':
    case 'loci':
      return 'gps'
    case '©mak':
    case '©mod':
      return 'camera'
    case '©day':
      return 'datetime'
    default:
      return 'other'
  }
}

// keys: FullBox(4) + 件数(4) + [長さ(4) + 名前空間(4) + 名前]…
function keyNames(bytes: Uint8Array, keys: Box): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const names: string[] = []
  if (keys.bodyAt + 8 > keys.end) return names
  const count = view.getUint32(keys.bodyAt + 4)
  let at = keys.bodyAt + 8
  for (let i = 0; i < count && at + 8 <= keys.end; i++) {
    const size = view.getUint32(at)
    if (size < 8 || at + size > keys.end) break
    names.push(LATIN1.decode(bytes.subarray(at + 8, at + size)))
    at += size
  }
  return names
}

// meta の中身が何の情報か。QuickTime の meta は版と印を持たず、ISO の meta は
// 持つ (4 バイト)。先頭に hdlr が見えるかで見分ける
function metaKinds(bytes: Uint8Array, meta: Box): MetaKind[] {
  const plain = LATIN1.decode(bytes.subarray(meta.bodyAt + 4, meta.bodyAt + 8)) === 'hdlr'
  const children = readBoxes(bytes, plain ? meta.bodyAt : meta.bodyAt + 4, meta.end, false)
  const keys = children.find((child) => child.type === 'keys')
  if (keys) {
    return keyNames(bytes, keys).map(keyKind)
  }
  const ilst = children.find((child) => child.type === 'ilst')
  return ilst
    ? readBoxes(bytes, ilst.bodyAt, ilst.end, false).map((item) => atomKind(item.type))
    : ['other']
}

function udtaKinds(bytes: Uint8Array, udta: Box): MetaKind[] {
  return readBoxes(bytes, udta.bodyAt, udta.end, false).flatMap((child) =>
    child.type === 'meta' ? metaKinds(bytes, child) : [atomKind(child.type)],
  )
}

export function stripVideoMeta(input: Uint8Array<ArrayBuffer>): StripOutcome {
  const top = readBoxes(input, 0, input.byteLength, false)
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) {
    throw new PhotoMetaFormatError('moov がありません')
  }
  const out = input.slice()
  const removed = new Set<MetaKind>()
  let changed = false

  // 型を free に替えて中身を 0 で埋める。長さは変えない
  const neutralize = (box: Box, kinds: Iterable<MetaKind>) => {
    out.set(FREE, box.start + 4)
    out.fill(0, box.bodyAt, box.end)
    for (const kind of kinds) removed.add(kind)
    changed = true
  }

  // 作成・更新の日時 (版 0 は 32 ビット × 2、版 1 は 64 ビット × 2)。
  // 版と印の 4 バイトの直後に並ぶ
  const zeroTimes = (box: Box) => {
    const width = out[box.bodyAt] === 1 ? 16 : 8
    const from = box.bodyAt + 4
    if (from + width > box.end) {
      throw new PhotoMetaFormatError(`${box.type} が短すぎます`)
    }
    if (out.subarray(from, from + width).some((byte) => byte !== 0)) {
      out.fill(0, from, from + width)
      removed.add('datetime')
      changed = true
    }
  }

  const walk = (from: number, to: number, depth: number) => {
    if (depth > MAX_DEPTH) {
      throw new PhotoMetaFormatError('箱の入れ子が深すぎます')
    }
    for (const box of readBoxes(input, from, to, true)) {
      if (box.type === 'udta') {
        neutralize(box, udtaKinds(input, box))
      } else if (box.type === 'meta') {
        neutralize(box, metaKinds(input, box))
      } else if (isXmpUuid(input, box)) {
        neutralize(box, ['xmp'])
      } else if (TIMED_HEADERS.has(box.type)) {
        zeroTimes(box)
      } else if (CONTAINERS.has(box.type)) {
        walk(box.bodyAt, box.end, depth + 1)
      }
    }
  }

  for (const box of top) {
    if (box.type === 'meta') {
      neutralize(box, metaKinds(input, box))
    } else if (isXmpUuid(input, box)) {
      neutralize(box, ['xmp'])
    }
  }
  walk(moov.bodyAt, moov.end, 1)
  return changed ? { bytes: out, removed } : { bytes: input, removed: new Set() }
}
