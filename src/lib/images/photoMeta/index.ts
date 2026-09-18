// 写真の撮影情報 (位置・日時・機種など) を抜く入口 (docs/97-写真の撮影情報削除計画.md)。
//
// 保存経路 (attachments/storeImage.ts・attachments/restore.ts) とバックフィル
// (scripts/backfillPhotoMeta.ts) がここを呼ぶ。形式ごとの抜き方は同じ階層の
// jpeg.ts / png.ts / webp.ts / gif.ts / avif.ts が持つ。
//
// **再エンコードしない** (§2-3)。区画を抜いて繋ぎ直すだけなので画質もサイズも
// 変わらない。ただし区画の並びを読めない画像は sharp で作り直す — 画質は落ちるが
// 撮影情報は確実に落ちる。黙って素通しはしない (fail-closed)。

import 'server-only'
import sharp from 'sharp'
import { MAX_INPUT_PIXELS } from '../thumbConfig'
import { stripAvif } from './avif'
import { stripGif } from './gif'
import { stripJpeg } from './jpeg'
import { stripPng } from './png'
import type { StripOutcome } from './types'
import { stripWebp } from './webp'

export type { MetaKind, StripOutcome } from './types'

// 素通しで保存する形式 (images/normalizeImage.ts の PASSTHROUGH_MIME)。
// HEIC / TIFF は保存前に sharp で WebP へ変換され、その時点で撮影情報は落ちている
const PHOTO_FORMATS = ['jpg', 'png', 'webp', 'gif', 'avif'] as const
export type PhotoFormat = (typeof PHOTO_FORMATS)[number]

export function isPhotoFormat(value: string): value is PhotoFormat {
  return (PHOTO_FORMATS as readonly string[]).includes(value)
}

const STRIPPERS: Record<PhotoFormat, (input: Uint8Array<ArrayBuffer>) => StripOutcome> = {
  jpg: stripJpeg,
  png: stripPng,
  webp: stripWebp,
  gif: stripGif,
  avif: stripAvif,
}

// 区画を抜いて、何を抜いたかも返す。区画を読めなければ例外。
// 作り直しはしない (バックフィルの下見が「読めない画像」を数えるため)
export function analyzePhotoMeta(
  bytes: Uint8Array<ArrayBuffer>,
  format: PhotoFormat,
): StripOutcome {
  return STRIPPERS[format](bytes)
}

// 作り直し。向きは画素へ焼く (EXIF ごと落ちるので、焼かないと横倒しになる)。
// アニメーションは向きを持たない前提でコマを保つほうを取る
async function reencode(
  bytes: Uint8Array<ArrayBuffer>,
  format: PhotoFormat,
): Promise<Uint8Array<ArrayBuffer>> {
  const animated = format === 'gif' || format === 'webp'
  const input = sharp(bytes, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS, animated })
  const oriented = animated ? input : input.autoOrient()
  // 品質は回転 (images/rotateImage.ts) と揃える
  const encoded = {
    jpg: () => oriented.jpeg({ quality: 90 }),
    png: () => oriented.png(),
    webp: () => oriented.webp({ quality: 85 }),
    gif: () => oriented.gif(),
    avif: () => oriented.avif(),
  }[format]()
  // Buffer は共有プールを指しうるため自前の ArrayBuffer へ写す
  return new Uint8Array(await encoded.toBuffer())
}

// 撮影情報を抜いたバイト列を返す。区画を読めなければ sharp で作り直す。
// 作り直しにも失敗したら例外 (呼ぶ側が「読み込めませんでした」で断る)
export async function stripPhotoMeta(
  bytes: Uint8Array<ArrayBuffer>,
  format: PhotoFormat,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return analyzePhotoMeta(bytes, format).bytes
  } catch (error) {
    // 型の決まった失敗 (PhotoMetaFormatError) に限らず作り直す。読み取りの穴で
    // RangeError が出ても、素通しにはしない
    console.warn(
      `撮影情報の区画を読めないため作り直します (${format}, ${bytes.byteLength} bytes):`,
      error instanceof Error ? error.message : error,
    )
    return reencode(bytes, format)
  }
}
