// 埋め込みモデルの初回読み込みの状態遷移 (41-QR-search/docs/11-画像検索調査メモ.md)。
//
// WebGPU で落ちたら WASM で 1 度だけ組み直す、という再試行を純関数に切り出す。
// Worker の生成・破棄という副作用は useImageEmbedder が持ち、ここは「次に何を
// すべきか」だけを決める (Worker なしでテストできるようにするため)。

export type EmbedderPhase =
  // 1 回目 (WebGPU が使えるなら WebGPU) の読み込み中
  | 'loading'
  // 1 回目が落ち、WASM 強制の Worker で読み直している最中
  | 'retrying-wasm'
  | 'ready'
  | 'failed'

export interface EmbedderLoadState {
  phase: EmbedderPhase
  // 失敗が確定したときの生の理由。phase === 'failed' のときだけ入る
  failureMessage: string | null
}

export type EmbedderLoadEvent =
  | { type: 'ready' }
  // モデルを用意できなかった (preload の load-error、または 1 度も ready に
  // ならないままの埋め込みエラー)
  | { type: 'load-failure'; message: string }

export const INITIAL_EMBEDDER_LOAD_STATE: EmbedderLoadState = {
  phase: 'loading',
  failureMessage: null,
}

export function reduceEmbedderLoad(
  state: EmbedderLoadState,
  event: EmbedderLoadEvent,
): EmbedderLoadState {
  if (event.type === 'ready') {
    return { phase: 'ready', failureMessage: null }
  }
  // 読み込み済みなら、1 枚の失敗は壊れたフレームであってモデル不調ではない
  if (state.phase === 'ready') {
    return state
  }
  if (state.phase === 'loading') {
    // まだ諦めない。WASM 強制で組み直せば救える端末がある (iPhone の
    // WebGPU 初期化 OOM)。1 回目の理由は UI に出さず、再試行の結末を待つ
    return { phase: 'retrying-wasm', failureMessage: null }
  }
  // retrying-wasm か failed。WASM でも駄目なら打つ手はないので確定させる
  return { phase: 'failed', failureMessage: event.message }
}

// 遷移を見て「WASM 強制の Worker を起こし直す番か」を判定する。
// 再試行の開始は 1 度きり (retrying-wasm へ入った瞬間) なので、状態を見比べる
// だけで済み、呼び手が回数を数えなくてよい。
export function needsWasmRespawn(
  prev: EmbedderLoadState,
  next: EmbedderLoadState,
): boolean {
  return prev.phase !== 'retrying-wasm' && next.phase === 'retrying-wasm'
}

// メモリが逼迫した端末とみなす JS ヒープ上限 (MB)。通常の x64 Chrome は
// 約 4GB。実測した constrained な Windows Chrome は 1120MB で、WebGPU の
// 初回試行 (asyncify ランタイム + ヒープ) の途中で OOM した
export const CONSTRAINED_HEAP_LIMIT_MB = 2048

// 1 回目から WASM で組むべきか。
//
// WebGPU → 失敗 → WASM の再試行は普通の端末では無害だが、ヒープ上限が
// 小さい端末では **WebGPU の試行自体が OOM の引き金**になる (実測:
// DevTools が「メモリ不足クラッシュの発生前に一時停止」で止めた先は
// WebGPU 用 asyncify ランタイムのヒープ構築だった)。数値が取れて、かつ
// 小さいときだけ最初から WASM にする。iPhone (WebKit) は数値が取れない
// (null) ので従来どおり WebGPU から試す — そちらは WebGPU が正常に動く
export function shouldStartWithWasm(
  snapshot: { limitMB: number } | null,
): boolean {
  return snapshot !== null && snapshot.limitMB < CONSTRAINED_HEAP_LIMIT_MB
}
