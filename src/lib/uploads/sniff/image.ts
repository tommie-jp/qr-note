// 画像の形式を先頭バイトから決める (docs/26-画像形式対応計画.md)。
// アップロード経路・書影取得 (coverLookup)・サムネの埋め戻し (scripts/backfillThumbs.ts)
// が共有する。保存名と配信 mime の規則は names.ts が持つ。

import { startsWith } from './bytes'
import { readIsoBmffBrands } from './isoBmff'

// アップロードで受け付ける画像形式。normalizeImage はこの値で
// 「無変換保存」か「WebP へ変換」かを振り分ける (docs/26 §2)。
export type ImageFormat = 'png' | 'jpg' | 'gif' | 'webp' | 'avif' | 'heic' | 'tiff'

// offset 0 固定の先頭バイト署名。png/jpg/gif/webp/tiff はこれで判定できる。
// クライアント申告の MIME を信用せず、実際の中身から形式を決める
// (MIME を空で送る OS があり、詐称対策にもなる)
const HEAD_SIGNATURES: Array<[ImageFormat, number[]]> = [
  ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['jpg', [0xff, 0xd8, 0xff]],
  ['gif', [0x47, 0x49, 0x46, 0x38]], // "GIF8" (87a/89a 共通)
  ['tiff', [0x49, 0x49, 0x2a, 0x00]], // "II*\0" little-endian
  ['tiff', [0x4d, 0x4d, 0x00, 0x2a]], // "MM\0*" big-endian
]

// WebP は RIFF コンテナ: "RIFF" (0) + "WEBP" (8)
function isWebp(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    [0x57, 0x45, 0x42, 0x50].every((byte, i) => bytes[8 + i] === byte)
  )
}

// HEIC/AVIF は ISO-BMFF。offset 4 の "ftyp" ボックスに major brand と
// compatible brands が並ぶ。offset 0 固定署名では判定できないため、
// ブランド一覧を読んで種別を決める (docs/26 §4)
const AVIF_BRANDS = new Set(['avif', 'avis'])
// mif1/msf1 は HEIF 汎用ブランドで AVIF ファイルにも現れうるが、
// AVIF を先に判定するのでここに残してよい (HEVC 系の総称として扱う)
const HEIC_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis',
  'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1',
])

function sniffIsoBmff(bytes: Uint8Array): ImageFormat | null {
  const brands = readIsoBmffBrands(bytes)
  if (!brands) {
    return null
  }
  // AVIF を先に見る: mif1 を兼ねる AVIF を HEIC と誤判定しないため
  if (brands.some((b) => AVIF_BRANDS.has(b))) {
    return 'avif'
  }
  if (brands.some((b) => HEIC_BRANDS.has(b))) {
    return 'heic'
  }
  return null // ftyp だが画像でない (mp4 動画など)
}

// 先頭バイトから画像形式を判定する。判定できなければ null (=非対応)。
// アップロード経路・書影取得の両方がこれを唯一の入口にする
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  for (const [format, signature] of HEAD_SIGNATURES) {
    if (startsWith(bytes, signature)) {
      return format
    }
  }
  if (isWebp(bytes)) {
    return 'webp'
  }
  return sniffIsoBmff(bytes)
}
