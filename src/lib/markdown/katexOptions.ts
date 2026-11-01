// KaTeX の描画オプション (単一ソース)。
//
// markdownPipeline (ノート表示の rehype-katex) と mathText (一覧のサーバ描画)
// の両方が同じ値を使う。markdownPipeline に置いたままだと、一覧ルートが
// この 1 定数のために react-markdown / rehype-sanitize の束を丸ごと
// 引き込んでしまうので、依存を持たない葉としてここに置く
// (markdown/fenceLanguages.ts / markdown/alerts.ts と同じ作法)。

// \rule{99999em}{...} のような巨大サイズ指定でページを潰せないよう上限を設ける
// (KaTeX の maxSize デフォルトは Infinity)
const KATEX_MAX_SIZE_EM = 50

// strict: 'ignore' … 既定の 'warn' は不正な入力 (非標準の記法) のたびにサーバの
// console.warn を呼び、/logs の 200 件の控えを公開ノート 1 件で押し流せる
// (2026-11 の監査 LOW)。描画結果は変わらない (警告するかどうかだけ)
export const KATEX_OPTIONS = { maxSize: KATEX_MAX_SIZE_EM, strict: 'ignore' as const }
