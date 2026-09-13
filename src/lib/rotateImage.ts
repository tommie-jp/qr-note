// 挿入済み画像を 90° 単位で回して同一形式へ再符号化する (docs/49-画像回転計画.md)。
//
// 保存済みの原寸バイト列を受け取り、時計回りに angle 度回した新しいバイト列を返す。
// 呼び出し側 (api/images/[name]/rotate) はこれを saveImage() に渡して**新 UUID で
// 保存し直す** — 同名上書きは immutable キャッシュに阻まれるため (docs/49 §1)。

import 'server-only'
import sharp from 'sharp'
import { MAX_INPUT_PIXELS } from './images/thumbConfig'

// 90° 単位のみ許す。任意角は再符号化のたびに補間で滲むので扱わない。
export type RotateAngle = 90 | 180 | 270

export function isRotateAngle(value: unknown): value is RotateAngle {
  return value === 90 || value === 180 || value === 270
}

// 保存名の拡張子 → 再符号化のフォーマット。gif は含めない (アニメ GIF の
// フレーム保持が sharp 既定では効かないため、呼び出し側で先に弾く。docs/49 §3)。
// heic/tiff は保存時点で webp へ変換済みなので、ここには現れない。
const ROTATABLE_EXTS = ['png', 'jpg', 'webp', 'avif'] as const
type RotatableExt = (typeof ROTATABLE_EXTS)[number]

export function isRotatableExt(ext: string): ext is RotatableExt {
  return (ROTATABLE_EXTS as readonly string[]).includes(ext)
}

// ext に応じた再符号化。品質は保存経路 (normalizeImage / thumbnail) と揃える。
function encodeAs(pipeline: sharp.Sharp, ext: RotatableExt): sharp.Sharp {
  switch (ext) {
    case 'png':
      return pipeline.png()
    case 'jpg':
      return pipeline.jpeg({ quality: 90 })
    case 'webp':
      return pipeline.webp({ quality: 85 })
    case 'avif':
      return pipeline.avif()
  }
}

// 原寸バイト列を時計回りに angle 度回して、同じ ext の形式で返す。
// 復号・符号化に失敗したら例外を投げる (呼び出し側が 500 ではなく 4xx で断る)。
//
// **autoOrient() が先に要る。** passthrough 保存の JPEG は EXIF に向きを持った
// ままで (normalizeImage が jpg/png 等を素通しするため)、ブラウザは表示時に
// その EXIF を見て起こしている。EXIF を残したまま画素だけ rotate すると、
// 保存後にブラウザが再び EXIF で起こして二重回転になる。autoOrient() で EXIF の
// 向きを画素へ焼き、sharp が既定でメタデータを落とすことで、出力は画素の向きが
// 正になる (normalizeImage.ts / thumbnail.ts の .rotate() と同じ狙い)。
export async function rotateImageBytes(
  bytes: Uint8Array<ArrayBuffer>,
  ext: RotatableExt,
  angle: RotateAngle,
): Promise<Uint8Array<ArrayBuffer>> {
  const pipeline = sharp(bytes, {
    failOn: 'none',
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .autoOrient()
    .rotate(angle)
  const out = await encodeAs(pipeline, ext).toBuffer()
  // Buffer は共有プールを指しうるため自前の ArrayBuffer へ写す
  // (Prisma の Bytes は ArrayBuffer 実体の Uint8Array だけを受ける)
  return new Uint8Array(out)
}
