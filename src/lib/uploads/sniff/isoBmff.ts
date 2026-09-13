// ISO-BMFF (HEIC/AVIF・m4a・mp4/mov) の箱を読む小道具
// (docs/93-リファクタリング計画.md §4-2)。画像・音声・動画の判定が共有する。

import { encodeAscii, matchesAt, startsWith } from './bytes'

// ISO-BMFF の ftyp ボックスから brand 一覧 (major + compatible) を読む。
// ISO-BMFF でない・短すぎる入力は null。画像 (HEIC/AVIF) と音声 (m4a) の
// どちらもこの一覧を見て種別を決めるので、読み取り自体はここに集約する。
export function readIsoBmffBrands(bytes: Uint8Array): string[] | null {
  // ボックス長(4) + "ftyp"(4) + major brand(4) の最低 12 バイトが無ければ
  // ISO-BMFF ではない。下の getUint32 が短い入力で throw しないための明示ガード
  // でもある (この関数は throw しない契約。呼び出し側は try/catch しない)
  if (bytes.byteLength < 12) {
    return null
  }
  // "ftyp" が offset 4 に無ければ ISO-BMFF ではない
  if (!startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])) {
    return null
  }
  // ボックス長で compatible brands の走査範囲を縛る (壊れた長さは全長で代用)
  const declared = new DataView(
    bytes.buffer, bytes.byteOffset, bytes.byteLength,
  ).getUint32(0)
  const end = declared >= 16 && declared <= bytes.byteLength ? declared : bytes.byteLength
  const decoder = new TextDecoder('latin1')
  // major brand(8..12) と compatible brands(16..) を集める (12..16 は minor version)
  const brands: string[] = [decoder.decode(bytes.subarray(8, 12))]
  for (let off = 16; off + 4 <= end; off += 4) {
    brands.push(decoder.decode(bytes.subarray(off, off + 4)))
  }
  return brands
}

// ISO-BMFF のトップレベルから指定のボックスを探して中身を返す (無ければ null)。
// ボックスは [長さ(4)][型(4)][中身] の並び。長さ 1 は 64bit 拡張長 (型の直後に
// 8 バイト)、長さ 0 は「ファイル末尾まで」を意味する。
// 壊れた長さで無限ループしないよう、進めない長さを見たら諦める (throw しない)。
export function findTopLevelBox(bytes: Uint8Array, type: string): Uint8Array | null {
  if (bytes.byteLength < 8) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // 型はバイトのまま比べる。1 ボックスごとに文字列へ起こすと、細かいボックスを
  // 大量に並べた入力で確保だけが積み上がる
  const wanted = encodeAscii(type)
  let at = 0
  while (at + 8 <= bytes.byteLength) {
    const declared = view.getUint32(at)
    let size = declared
    let headerSize = 8
    if (declared === 1) {
      if (at + 16 > bytes.byteLength) {
        return null
      }
      size = Number(view.getBigUint64(at + 8))
      headerSize = 16
    } else if (declared === 0) {
      size = bytes.byteLength - at
    }
    if (matchesAt(bytes, at + 4, wanted, bytes.byteLength)) {
      return bytes.subarray(at + headerSize, Math.min(at + size, bytes.byteLength))
    }
    if (size < headerSize) {
      return null // 進めない長さ = 壊れている。ここで諦める
    }
    at += size
  }
  return null
}

// hdlr ボックスの並び [長さ(4)]["hdlr"(4)][version+flags(4)][pre_defined(4)]
// [handler(4)] から handler だけを集める。moov の中は入れ子 (trak > mdia > hdlr)
// なので、構造を全部たどらず "hdlr" の出現位置から直接読む。
const HDLR_TYPE = encodeAscii('hdlr')
const HDLR_HANDLER_OFFSET = 12 // "hdlr" の先頭から handler までの距離

export function handlerTypesIn(moov: Uint8Array): string[] {
  const decoder = new TextDecoder('latin1')
  const handlers: string[] = []
  const limit = moov.byteLength
  for (let at = 0; at + HDLR_HANDLER_OFFSET + 4 <= limit; at++) {
    if (matchesAt(moov, at, HDLR_TYPE, limit)) {
      const from = at + HDLR_HANDLER_OFFSET
      handlers.push(decoder.decode(moov.subarray(from, from + 4)))
    }
  }
  return handlers
}
