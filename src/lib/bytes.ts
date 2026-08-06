// バイト列の細かい取り回し。**依存を持たない**ので、クライアント・サーバ・
// テストのどこからでも読める。
//
// 同じ 5 行を書き写す場所が増えたので 1 か所に集めた (暗号エンベロープ・
// ZIP の展開・添付の保存)。

// 自分だけの ArrayBuffer 実体に写す。
//
// Uint8Array の既定の型は Uint8Array<ArrayBufferLike> で、SharedArrayBuffer 由来の
// ものを含みうる。WebCrypto は BufferSource として受け付けず、Prisma の Bytes も
// ArrayBuffer 実体の Uint8Array しか受けない。長さを指定して確保し直せば実体が
// 確定する。**部分ビュー (subarray) を切り離す**役目もある — fflate が返す
// バイト列は入力バッファ全体への窓なので、そのまま DB へ渡せない。
export function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const owned = new Uint8Array(bytes.byteLength)
  owned.set(bytes)
  return owned
}

// 手元にあるバイト列を、流し込む形の口 (AsyncIterable) に合わせて刻む。
//
// 「本文をストリームで受ける」前提の関数へ、既にメモリにあるバイト列を渡す
// ための橋。**刻む大きさには意味がある**ことがある — ZIP の展開 (lib/zip/
// readZip.ts) は 1 回の push が大きいと項目ごとの再帰でスタックを使い切る。
export async function* chunkedBytes(
  bytes: Uint8Array,
  chunkBytes = 64 * 1024,
): AsyncGenerator<Uint8Array> {
  for (let start = 0; start < bytes.byteLength; start += chunkBytes) {
    yield bytes.subarray(start, start + chunkBytes)
  }
}

// 分かれて届いたバイト列を 1 本に繋ぐ。合計長を渡せば数え直さない。
export function concatBytes(
  chunks: readonly Uint8Array[],
  totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
): Uint8Array<ArrayBuffer> {
  const merged = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}
