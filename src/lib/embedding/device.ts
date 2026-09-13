// 埋め込みを実行するデバイス (実行プロバイダ) の決定 (41-QR-search/docs/11-画像検索調査メモ.md)。
//
// 判定そのものは環境の問い合わせ (Node かどうか・WebGPU アダプタが取れるか) と
// 分けて純関数に置く。実際の問い合わせは embedder.ts が行い、その結果をここに渡す。

export type EmbeddingDevice = 'webgpu' | 'wasm' | undefined

export interface DeviceContext {
  // Node (サーバ・バックフィル) か
  isNode: boolean
  // ブラウザで WebGPU のアダプタが実際に取れたか (Node では無意味)
  hasWebGpuAdapter: boolean
  // WebGPU での初回読み込みに失敗した後の再試行か。true なら WebGPU は試さない
  forceWasm: boolean
}

// Node では undefined を返し、transformers.js に onnxruntime-node (native cpu) を
// 選ばせる (Node は 'wasm' を受け付けない)。
//
// ブラウザでは WebGPU が**実際に使えれば**使い (iOS 26+/Safari 26)、駄目なら WASM。
// navigator.gpu の有無だけで決めてはいけない。WSL2 やソフトウェア描画の環境は
// API を生やしておきながらアダプタを返さないので、アダプタが取れたかで判定する
// (WASM で動くのが基準性能、WebGPU は加速ボーナス、が設計方針)。
export function resolveDevice(ctx: DeviceContext): EmbeddingDevice {
  if (ctx.isNode) {
    return undefined
  }
  if (ctx.forceWasm) {
    return 'wasm'
  }
  return ctx.hasWebGpuAdapter ? 'webgpu' : 'wasm'
}
