// EXIF の中身 (TIFF 構造) を読む小道具と、向きだけを持つ最小 EXIF の組み立て
// (docs/113-写真の撮影情報削除計画.md §2-3 / §3-7)。
//
// EXIF は TIFF の形をしている: 先頭 8 バイトのヘッダ (並び "II" / "MM"、42、
// IFD0 の位置) の後に IFD (項目の表) が続く。IFD0 から Exif IFD (0x8769)・
// GPS IFD (0x8825) へ位置で辿れる。
//
// ここは**読むだけ**で、壊れた入力でも例外を投げない。読めなければ
// 「何も無い」を返す — 呼ぶ側は EXIF の区画を丸ごと落とすので、読めなくても
// 漏れることはない (向きが失われるだけ)。

const TAG_ORIENTATION = 0x0112
const TAG_MAKE = 0x010f
const TAG_MODEL = 0x0110
const TAG_DATETIME = 0x0132
const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_DATETIME_DIGITIZED = 0x9004
const TAG_GPS_LATITUDE = 0x0002
const TAG_GPS_LONGITUDE = 0x0004

const TYPE_SHORT = 3
const ENTRY_SIZE = 12
// 1 つの IFD の項目数の上限。実物のカメラは IFD0 で 20 前後。壊れた件数で
// 延々と回らないための安全弁 (範囲検査もするので、これは早めに諦めるだけ)
const MAX_ENTRIES = 1024

export interface ExifFacts {
  // 1〜8。無い・読めない・範囲外は null
  readonly orientation: number | null
  readonly gps: boolean
  readonly datetime: boolean
  readonly camera: boolean
  // IFD0 に向きの項目だけがあり、他の IFD へも繋がっていない
  // (= この処理が書き戻した最小 EXIF と同じ中身)
  readonly onlyOrientation: boolean
}

const NOTHING: ExifFacts = {
  orientation: null,
  gps: false,
  datetime: false,
  camera: false,
  onlyOrientation: false,
}

interface IfdEntry {
  readonly type: number
  readonly count: number
  // 項目の 8〜12 バイト目 (4 バイト以内の値そのもの、または値の位置)
  readonly valueAt: number
}

interface Reader {
  readonly view: DataView
  readonly little: boolean
}

function readIfd(reader: Reader, offset: number): Map<number, IfdEntry> | null {
  const { view, little } = reader
  if (offset < 8 || offset + 2 > view.byteLength) {
    return null
  }
  const count = view.getUint16(offset, little)
  if (count > MAX_ENTRIES || offset + 2 + count * ENTRY_SIZE > view.byteLength) {
    return null
  }
  const entries = new Map<number, IfdEntry>()
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * ENTRY_SIZE
    entries.set(view.getUint16(at, little), {
      type: view.getUint16(at + 2, little),
      count: view.getUint32(at + 4, little),
      valueAt: at + 8,
    })
  }
  return entries
}

// IFD0 の次の IFD (IFD1 = 縮小版のサムネ) の位置。0 なら無い
function nextIfdOffset(reader: Reader, offset: number, count: number): number {
  const at = offset + 2 + count * ENTRY_SIZE
  return at + 4 <= reader.view.byteLength ? reader.view.getUint32(at, reader.little) : 0
}

function readPointer(reader: Reader, entry: IfdEntry | undefined): number | null {
  if (!entry) {
    return null
  }
  return reader.view.getUint32(entry.valueAt, reader.little)
}

function readOrientationValue(reader: Reader, entry: IfdEntry | undefined): number | null {
  if (!entry || entry.type !== TYPE_SHORT || entry.count < 1) {
    return null
  }
  const value = reader.view.getUint16(entry.valueAt, reader.little)
  return value >= 1 && value <= 8 ? value : null
}

export function readExifFacts(tiff: Uint8Array): ExifFacts {
  if (tiff.byteLength < 8) {
    return NOTHING
  }
  const order = String.fromCharCode(tiff[0], tiff[1])
  if (order !== 'II' && order !== 'MM') {
    return NOTHING
  }
  const reader: Reader = {
    view: new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength),
    little: order === 'II',
  }
  if (reader.view.getUint16(2, reader.little) !== 42) {
    return NOTHING
  }
  const ifd0Offset = reader.view.getUint32(4, reader.little)
  const ifd0 = readIfd(reader, ifd0Offset)
  if (!ifd0) {
    return NOTHING
  }

  const exifIfdAt = readPointer(reader, ifd0.get(TAG_EXIF_IFD))
  const exifIfd = exifIfdAt === null ? null : readIfd(reader, exifIfdAt)
  const gpsIfdAt = readPointer(reader, ifd0.get(TAG_GPS_IFD))
  const gpsIfd = gpsIfdAt === null ? null : readIfd(reader, gpsIfdAt)

  return {
    orientation: readOrientationValue(reader, ifd0.get(TAG_ORIENTATION)),
    gps: gpsIfd !== null && (gpsIfd.has(TAG_GPS_LATITUDE) || gpsIfd.has(TAG_GPS_LONGITUDE)),
    datetime:
      ifd0.has(TAG_DATETIME) ||
      (exifIfd !== null &&
        (exifIfd.has(TAG_DATETIME_ORIGINAL) || exifIfd.has(TAG_DATETIME_DIGITIZED))),
    camera: ifd0.has(TAG_MAKE) || ifd0.has(TAG_MODEL),
    onlyOrientation:
      ifd0.size === 1 &&
      ifd0.has(TAG_ORIENTATION) &&
      nextIfdOffset(reader, ifd0Offset, ifd0.size) === 0,
  }
}

// 向き (1〜8) だけを持つ TIFF。26 バイト固定 (§3-7)。
// リトルエンディアンで書く — どちらでもよいが、固定しておくと 2 回掛けたときに
// 同じバイト列になる (冪等)
export function minimalExifTiff(orientation: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(26)
  const view = new DataView(out.buffer)
  out.set([0x49, 0x49], 0) // "II"
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true) // IFD0 は直後
  view.setUint16(8, 1, true) // 項目 1 つ
  view.setUint16(10, TAG_ORIENTATION, true)
  view.setUint16(12, TYPE_SHORT, true)
  view.setUint32(14, 1, true)
  view.setUint16(18, orientation, true)
  view.setUint32(22, 0, true) // 次の IFD は無い
  return out
}

// 向きを書き戻す必要があるか。1 (正位置) なら書かない方が短く、表示も同じ
export function needsOrientation(orientation: number | null): orientation is number {
  return orientation !== null && orientation !== 1
}

// JPEG の APP1・WebP の EXIF は "Exif\0\0" の後に TIFF が続く。PNG の eXIf は
// TIFF から始まる決まりだが、頭に付けてくる書き手もある。どちらでも TIFF を返す
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]

export function withoutExifHeader(payload: Uint8Array): Uint8Array {
  const hasHeader =
    payload.byteLength >= EXIF_HEADER.length &&
    EXIF_HEADER.every((byte, i) => payload[i] === byte)
  return hasHeader ? payload.subarray(EXIF_HEADER.length) : payload
}

export function withExifHeader(tiff: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(EXIF_HEADER.length + tiff.byteLength)
  out.set(EXIF_HEADER, 0)
  out.set(tiff, EXIF_HEADER.length)
  return out
}
