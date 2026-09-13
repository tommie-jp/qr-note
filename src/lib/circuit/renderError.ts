// 回路図の描画エラー (docs/93-リファクタリング計画.md §2-2)。
//
// 描画 (circuitikz.ts) と SVG の検査 (hash.ts) の両方が投げ、ルート
// (api/circuits) と circuitCache.ts が instanceof で見分ける。検査側を
// 子プロセスの起動部から切り離すため、クラスはどちらにも属さないここに置く

export class CircuitRenderError extends Error {
  // TeX が stdout に吐いた原因 (`! Package pgfkeys Error: ...` と該当行)。
  // 例外の文言自体は原因を含まないため、表示にはこちらを使う
  readonly texLog: string

  constructor(message: string, texLog = '') {
    super(message)
    this.name = 'CircuitRenderError'
    this.texLog = texLog
  }
}
