// 画像特徴抽出パイプラインの出力テンソルから、1 本の正規化済みベクトルを取り出す。
//
// transformers.js の image-feature-extraction はモデルによって出力の形が違う:
//   - DINOv2 など: last_hidden_state [1, トークン数, 次元]。先頭 (index 0) が
//     画像全体を表す CLS トークンなので、それを埋め込みとして使う。
//   - CLIP など: image_embeds [1, 次元]。すでに 1 本なのでそのまま。
// どちらも最後に L2 正規化して、照合側は内積だけで cosine を取れるようにする。
//
// モデル読み込み (embedder.ts) から切り出した純関数。テンソルの中身
// (data/dims) だけを受けるので、transformers.js 無しで単体テストできる。

import { normalize } from './imageVector'

export interface TensorLike {
  data: Float32Array
  dims: number[]
}

// テンソル → 正規化済み Float32Array。
// dims が [1, D] ならその 1 行、[1, N, D] なら先頭トークン (CLS) を取る。
// それ以外の形は想定外なので投げる (黙って誤ったベクトルを返さない)。
export function extractEmbedding(tensor: TensorLike): Float32Array {
  const { data, dims } = tensor

  if (dims.length === 2 && dims[0] === 1) {
    // [1, D]
    return normalize(data.slice(0, dims[1]))
  }

  if (dims.length === 3 && dims[0] === 1) {
    // [1, N, D] → CLS トークン (先頭 D 要素)
    const dim = dims[2]
    return normalize(data.slice(0, dim))
  }

  throw new Error(`想定外の出力形状です: [${dims.join(', ')}]`)
}
