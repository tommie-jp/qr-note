// 画像埋め込みベクトルの表現と類似度計算 (docs/25-画像検索計画.md §1,4)。
//
// ベクトルは Float32Array。DB (images.embedding) には生のバイト列で持ち、
// 照合はクライアントで総当たり cosine を取る。数千件規模ではライブラリも
// 近似索引も要らない (調査メモの実測)。
//
// ここは純粋な数値処理だけを置く。モデルの読み込み・推論は
// src/lib/embedding/ に分ける (ブラウザ/Node で実体が変わるため)。

// x86 も ARM もリトルエンディアンで、保存も読み出しも自分のコードなので、
// バイト順は素の Float32Array のメモリ表現をそのまま使う。

// Float32Array を DB 保存用のバイト列にする。
// 元の buffer を共有せずコピーするので、呼び手が後から vec を触っても壊れない。
// 返りは素の ArrayBuffer 裏づけ (Prisma の Bytes は SharedArrayBuffer を受けない)。
export function serializeEmbedding(vec: Float32Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(vec.byteLength)
  out.set(new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength))
  return out
}

// 保存したバイト列を Float32Array に戻す。
//
// Prisma の Bytes (Uint8Array) は byteOffset が 4 の倍数とは限らず、
// そのまま new Float32Array(bytes.buffer) すると境界エラーになりうる。
// 必ず 4 バイト境界の新しい buffer へ写してから解釈する。
// 長さが 4 の倍数でなければ壊れたデータなので null を返す (黙って切り捨てない)。
export function deserializeEmbedding(bytes: Uint8Array): Float32Array | null {
  if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) {
    return null
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Float32Array(copy.buffer)
}

// L2 正規化した新しいベクトルを返す (元は変更しない)。
// ノルムが 0 (全成分 0) の場合はそのまま 0 ベクトルを返す。正規化済み同士の
// cosine は内積に一致するので、保存時とクエリ時に 1 度ずつ掛けておく。
export function normalize(vec: Float32Array): Float32Array {
  let sumSq = 0
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i]
  }
  const norm = Math.sqrt(sumSq)
  const out = new Float32Array(vec.length)
  if (norm === 0) {
    return out
  }
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm
  }
  return out
}

// 正規化済みベクトル同士の類似度 (= 内積 = cosine)。検索の内側ループで回すので
// ここでは正規化を仮定して割り算を省く。長さ違いは呼び手のバグなので投げる。
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`ベクトルの次元が違います: ${a.length} vs ${b.length}`)
  }
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i]
  }
  return sum
}

// 正規化を仮定しない一般の cosine 類似度。テストやバックフィルの検算用。
// どちらかが 0 ベクトルなら 0 を返す (0 除算を避ける)。
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`ベクトルの次元が違います: ${a.length} vs ${b.length}`)
  }
  let dotSum = 0
  let aSq = 0
  let bSq = 0
  for (let i = 0; i < a.length; i++) {
    dotSum += a[i] * b[i]
    aSq += a[i] * a[i]
    bSq += b[i] * b[i]
  }
  if (aSq === 0 || bSq === 0) {
    return 0
  }
  return dotSum / (Math.sqrt(aSq) * Math.sqrt(bSq))
}
