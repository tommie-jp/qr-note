import type { PluggableList } from "unified";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  KATEX_OPTIONS,
  linkWithTarget,
  sanitizeSchema,
  urlTransform,
} from "../markdownPipeline";

// <button> の中身は phrasing content に限られるので、選択肢を描くときは
// ブロック要素を**中身だけ残して**取り除く (unwrapDisallowed)。
// 段落だけでなく見出し・リスト・引用まで挙げているのは、選択肢に何が書かれても
// 不正な HTML にしないため — とくに GFM のタスクリストは <input> を生み、
// button の中に押せるものが入れ子になってしまう (hr と input は中身が無いので
// そのまま消える)。
//
// 許可リスト (allowedElements) にしないのは、KaTeX が MathML の要素を大量に
// 出すため。数式が消えないよう、こちらは「置けないもの」を挙げる形にする
const BLOCK_ELEMENTS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "pre",
  "hr",
  "div",
  "section",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "input",
];

const REMARK_PLUGINS = [remarkGfm, remarkBreaks, remarkMath];

const REHYPE_PLUGINS: PluggableList = [
  [rehypeSanitize, sanitizeSchema],
  [rehypeKatex, KATEX_OPTIONS],
];

const COMPONENTS = { a: linkWithTarget };

// 脚注の見出しは既定が英語の "Footnotes" で、隠す class はサニタイズで落ちる
// ため画面に出てしまう (MarkdownView と同じ手当て)。
//
// ただし**カードの中で脚注を使うのは避けたほうがよい** — 脚注の id は本文と
// 同じ採番規則なので、本文にも脚注があると番号が衝突し、押したときに本文側の
// 脚注へ飛ぶ。区画ごとに独立して描いている以上ここでは直せないので、
// メモ記法.md に「カードの中では使えない記法」として明記している
const REMARK_REHYPE_OPTIONS = {
  footnoteLabel: "脚注",
  footnoteBackLabel: "本文に戻る",
};

interface QuizMarkdownProps {
  markdown: string;
  // 選択肢のように <button> の中へ描くとき true
  inline?: boolean;
}

// ```quiz フェンスの中の一区画 (問題文・選択肢・解説) を markdown として描く
// (docs/58-CBT問題集計画.md §2)。
//
// 本文用の MarkdownView をそのまま入れ子にしないのは 2 つの理由から:
//   - MarkdownView は quiz フェンスを QuizFence へ振り分けるため、循環参照になる。
//   - MarkdownView は枠 (BOX_CLASS) 付きの器を描くので、カードの中で二重の枠に
//     見えてしまう。
// サニタイズ規則・URL の通し方・リンクの描き方は本文と同じものを使う
// (markdownPipeline) — ここだけ緩い規則を持つと、本文では通らない書き方が
// フェンスの中で通ってしまう。
//
// 対象は「文章と数式」に絞っている。画像記法は素の <img> になり、拡大表示・
// 音声/動画プレイヤー・シークレット断片への振り分けは効かない。本文の拡張記法
// (#タグ のリンク・アラート・折りたたみ) も効かない — 回路図と同じく、
// 凝ったものはフェンスの外に書く作法にしている (メモ記法.md に明記)
export function QuizMarkdown({ markdown, inline = false }: QuizMarkdownProps) {
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      remarkRehypeOptions={REMARK_REHYPE_OPTIONS}
      urlTransform={urlTransform}
      components={COMPONENTS}
      disallowedElements={inline ? BLOCK_ELEMENTS : undefined}
      unwrapDisallowed
    >
      {markdown}
    </Markdown>
  );
}
