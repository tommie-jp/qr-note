// 断片に貼る画像を、暗号化できる形へ整える (docs/51-部分暗号化計画.md §9)。
//
// **変換はクライアントでしかできない**。通常の画像は sharp がサーバで HEIC →
// WebP などに直しているが (docs/26)、シークレットはサーバが復号できないので
// そこに頼れない。canvas で描き直して、ブラウザが必ず出せる形式にする
// (描き直しそのものは imageCanvas.ts が持つ)。
//
// 描き直しには副産物として利点もある: EXIF (撮影場所・日時) が落ちる。
// 隠したい写真の位置情報が暗号文の外に残ることはない。

import { redrawImage } from './imageCanvas'
import { isSecretImageMime } from './secretPayload'

// 長辺の上限。原寸のスマホ写真 (4000px 超) をそのまま抱えると、復号のたびに
// その画素をメモリに広げることになる。読める大きさは十分に残る
const MAX_EDGE = 2048

// 書き出す形式。**出せない環境では canvas が黙って PNG を返す** (古い iOS
// Safari は WebP を書き出せない) ので、戻ってきた型を必ず確かめる。
// PNG でも保存はできる (大きくなるだけ)
const PREFERRED_TYPE = 'image/webp'

const QUALITY = 0.9

export interface SecretImageBytes {
  mime: string
  bytes: Uint8Array
}

// 選ばれたファイルを、断片に入れられる画像バイト列にする。
// 読めない形式 (HEIC を復号できないブラウザなど) は例外を投げる。
export async function prepareSecretImage(file: File): Promise<SecretImageBytes> {
  const blob = await redrawImage(file, {
    type: PREFERRED_TYPE,
    quality: QUALITY,
    maxEdge: MAX_EDGE,
  })
  // canvas が希望と違う形式を返すことがある (上記のとおり)。実際の型で確かめる
  if (!isSecretImageMime(blob.type)) {
    throw new Error('この画像形式はシークレットにできません')
  }
  return {
    mime: blob.type,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  }
}
