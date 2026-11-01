// jsdom は node-tikzjax の依存として入っているだけで型定義 (@types/jsdom) は無い。
// テスト (mermaid の後処理) がブラウザの document を作るのに使う最小限だけ名乗る
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string)
    readonly window: Window & typeof globalThis
  }
}
