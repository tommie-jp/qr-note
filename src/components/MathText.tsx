// 一覧に出す数式入りテキスト (docs/69-一覧数式計画.md)。
//
// サーバ (src/lib/mathText.ts) が KaTeX で描画し、地の文もエスケープ済みの
// HTML 文字列を受け取って埋め込むだけ。CircuitThumb と同じ型で、
// クライアント JS もローディング状態も無い。
// 生成側 (サーバ専用 module) をここから import しないこと (型だけなら可)。
//
// CSS の import はプロジェクトで MarkdownView.tsx に次ぐ 2 か所目。
// これで検索/ゴミ箱など一覧ルートにも KaTeX の CSS とフォントが載る
// (無いと数式が素の文字で崩れて出る)
import "katex/dist/katex.min.css";

export function MathText({ html }: { html: string }) {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
