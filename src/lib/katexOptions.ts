// KaTeX の描画オプション (単一ソース)。
//
// markdownPipeline (ノート表示の rehype-katex) と mathText (一覧のサーバ描画)
// の両方が同じ値を使う。markdownPipeline に置いたままだと、一覧ルートが
// この 1 定数のために react-markdown / rehype-sanitize の束を丸ごと
// 引き込んでしまうので、依存を持たない葉としてここに置く
// (fenceLanguages.ts / markdownAlerts.ts と同じ作法)。

// \rule{99999em}{...} のような巨大サイズ指定でページを潰せないよう上限を設ける
// (KaTeX の maxSize デフォルトは Infinity)
const KATEX_MAX_SIZE_EM = 50

export const KATEX_OPTIONS = { maxSize: KATEX_MAX_SIZE_EM }
