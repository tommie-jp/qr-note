// アップロードされた画像を「ブラウザが表示できる形式」に揃える入口。
//
// メモに貼った画像は、本文表示・クライアント OCR (createImageBitmap)・
// 画像検索の埋め込みが、どれも保存したバイト列を復号して使う。ブラウザが
// 表示できない形式をそのまま保存すると、これらが軒並み壊れる。そこで
// 保存する前にここで一度、普遍的な形式へ正規化する (docs/26-画像形式対応計画.md §2)。
//
//   png/jpg/gif/webp/avif … そのまま (全ブラウザが表示できる)
//   heic/heif             … WebP へ変換 (sharp の prebuilt は HEVC 非対応のため
//                           heic-decode(WASM libheif) で復号してから sharp で符号化)
//   tiff                  … WebP へ変換 (ブラウザが表示できない)

import 'server-only'
import { all as decodeHeicAll } from 'heic-decode'
import sharp from 'sharp'
import { MAX_INPUT_PIXELS } from './images/thumbConfig'
import type { ImageFormat } from './uploads/sniff/image'

export interface NormalizedImage {
  // saveImage にそのまま渡せる形 (Prisma Bytes は ArrayBuffer 実体を要求する)
  bytes: Uint8Array<ArrayBuffer>
  mime: string
  ext: string
}

// 変換せずそのまま保存してよい形式 → その MIME。
// ext は形式名がそのまま拡張子になる (jpg のみ MIME が image/jpeg)
const PASSTHROUGH_MIME: Partial<Record<ImageFormat, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
}

// 変換後の形式。透過を保て、全ブラウザが表示でき、サムネ (thumbnail.ts) と
// 同じく実績のある WebP に寄せる
const CONVERTED_MIME = 'image/webp'
const CONVERTED_EXT = 'webp'
const CONVERTED_QUALITY = 85

// WebP の 1 辺の上限 (px)。これを超える画像は sharp の符号化が失敗するため、
// 縦横比を保って収める (超える入力だけが縮む)
const WEBP_MAX_DIMENSION = 16383

// 受け取ったバイト列を、保存してよい形式に正規化する。
// 復号・符号化に失敗した場合は例外を投げる (壊れた画像を黙って保存しない)。
export async function normalizeImage(
  bytes: Uint8Array<ArrayBuffer>,
  format: ImageFormat,
): Promise<NormalizedImage> {
  const passthroughMime = PASSTHROUGH_MIME[format]
  if (passthroughMime) {
    return { bytes, mime: passthroughMime, ext: format }
  }

  // ここに来るのは heic / tiff のみ。どちらも WebP へ変換する
  const source =
    format === 'heic'
      ? await heicToSharp(bytes)
      : sharp(bytes, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS })

  const webp = await source
    // EXIF/HEIF の向きを画素へ焼く。スマホ写真は横倒しで保存され、向きは
    // メタデータにしかない。変換で落ちるメタデータに向きを残すと倒れて出る
    .rotate()
    .resize(WEBP_MAX_DIMENSION, WEBP_MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: CONVERTED_QUALITY })
    .toBuffer()

  // Buffer は共有プールを指しうるため自前の ArrayBuffer へ写す
  return { bytes: new Uint8Array(webp), mime: CONVERTED_MIME, ext: CONVERTED_EXT }
}

// HEIC を復号し、sharp が扱える raw 画素の入力にする。
//
// heic-decode は libheif の WASM 実装。本番 (node:24-alpine, musl) でも
// ネイティブビルドなしで動く。
//
// 解凍爆弾よけ: 入力は 10MB に制限してあるが HEVC はよく縮むため、小さな
// ファイルが数万×数万を名乗ると復号時に GB 単位を確保してプロセスごと
// 落とせる (単一プロセスなので全体停止になる)。all() はコンテナを解析
// するだけで画素を確保せず寸法を返すので、**確保の前に**画素数で弾く。
// (既定エクスポートの one() は先に全画素を確保してしまい先読みできない)
async function heicToSharp(bytes: Uint8Array<ArrayBuffer>): Promise<sharp.Sharp> {
  const images = await decodeHeicAll({ buffer: bytes })
  try {
    const primary = images[0]
    if (!primary) {
      throw new Error('HEIC に画像が含まれていません')
    }
    // 画素を確保する decode() の前に、宣言寸法で上限を超えるものを弾く
    // (thumbnail.ts / TIFF と同じ 50MP 上限を共有する)
    if (primary.width * primary.height > MAX_INPUT_PIXELS) {
      throw new Error(`HEIC の画素数が大きすぎます (${primary.width}x${primary.height})`)
    }
    const { width, height, data } = await primary.decode()
    // Buffer.from が画素を JS 側へ写すので、この後 dispose しても sharp は無事
    return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
  } finally {
    // libheif が確保した画像を解放する (WASM ヒープに残さない)
    images.dispose()
  }
}
