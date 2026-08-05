// 断片に貼る画像を、暗号化できる形へ整える (docs/51-部分暗号化計画.md §9)。
//
// **変換はクライアントでしかできない**。通常の画像は sharp がサーバで HEIC →
// WebP などに直しているが (docs/26)、シークレットはサーバが復号できないので
// そこに頼れない。canvas で描き直して、ブラウザが必ず出せる形式にする。
//
// 描き直しには副産物として利点もある: EXIF (撮影場所・日時) が落ちる。
// 隠したい写真の位置情報が暗号文の外に残ることはない。

import { isSecretImageMime } from './secretPayload'

// 長辺の上限。原寸のスマホ写真 (4000px 超) をそのまま抱えると、復号のたびに
// その画素をメモリに広げることになる。読める大きさは十分に残る
const MAX_EDGE = 2048

// 書き出す形式。**出せない環境では canvas が黙って PNG を返す** (古い iOS
// Safari は WebP を書き出せない) ので、戻ってきた型を必ず確かめる。
// PNG でも保存はできる (大きくなるだけ)
const PREFERRED_TYPE = 'image/webp'

const QUALITY = 0.9

// 長辺を limit に収めた大きさ (縦横比は保つ)。0 にはしない。
export function fitWithin(
  width: number,
  height: number,
  limit: number = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= limit) {
    return { width, height }
  }
  const scale = limit / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export interface SecretImageBytes {
  mime: string
  bytes: Uint8Array
}

// 選ばれたファイルを、断片に入れられる画像バイト列にする。
// 読めない形式 (HEIC を復号できないブラウザなど) は例外を投げる。
export async function prepareSecretImage(file: File): Promise<SecretImageBytes> {
  const bitmap = await decode(file)
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('画像を変換できませんでした')
    }
    context.drawImage(bitmap, 0, 0, width, height)

    const blob = await toBlob(canvas)
    // canvas が希望と違う形式を返すことがある (上記のとおり)。実際の型で確かめる
    if (!isSecretImageMime(blob.type)) {
      throw new Error('この画像形式はシークレットにできません')
    }
    return {
      mime: blob.type,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    }
  } finally {
    bitmap.close()
  }
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch (cause) {
    console.error('画像を読み取れませんでした', cause)
    // HEIC は iOS Safari 以外では復号できない。サーバ変換に頼れない以上、
    // ここで正直に断る (黙って壊れた画像を暗号化しない)
    throw new Error(
      'この画像を読み取れませんでした。別の形式 (JPEG / PNG) でお試しください',
    )
  }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error('画像を変換できませんでした'))
          return
        }
        resolve(blob)
      },
      PREFERRED_TYPE,
      QUALITY,
    )
  })
}
