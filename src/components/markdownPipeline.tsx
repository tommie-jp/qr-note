// markdown を描くときの共有部品 — サニタイズ規則・URL の通し方・リンクの描き方
// (MarkdownView から切り出し)。
//
// 切り出したのは、本文の一部を**入れ子で描く**部品ができたから
// (```quiz フェンスの問題文・選択肢・解説。docs/58-CBT問題集計画.md §2)。
// MarkdownView から直接 import すると、MarkdownView → QuizFence →
// MarkdownView の循環参照になる。規則そのものはどちらから見ても同じなので、
// 依存の葉としてここに置く。
//
// **入れ子側でも同じものを使うこと**が要点 — 別に緩い規則を持つと、本文では
// 通らない書き方がフェンスの中だけ通る穴になる。リンクの rel も同じで、
// 入れ子だけ素の <a> だと参照元 (ノートの URL) が外部サイトへ漏れる。

import type { ComponentProps, ReactNode } from "react";
import { defaultUrlTransform } from "react-markdown";
import { defaultSchema, type Options } from "rehype-sanitize";
import { ALERT_CLASS_PREFIX } from "./remarkAlerts";

// rehype-katex は code の math-inline / math-display クラスを目印にするため、
// sanitize で落とされないよう許可する (language-* はデフォルトでも許可)。
// sanitize → katex の順にすることで、ユーザー入力は sanitize 済み・
// KaTeX が生成した HTML はそのまま残る (remark-math 公式レシピ)
export const sanitizeSchema = {
  ...defaultSchema,
  // 脚注の id を二重に前置きしない (docs/54-markdown表示拡張計画.md §3)。
  // remark-rehype が既に `user-content-fn-1` の形で付けており、サニタイズが
  // その上からもう一度 `user-content-` を足すと id だけが
  // `user-content-user-content-fn-1` になって、参照リンク (href は書き換え
  // 対象外) と食い違う。脚注は出ているのに押しても飛ばない、という
  // 気づきにくい壊れ方をする。
  //
  // 外しても乗っ取りの余地は増えない: 生 HTML は無効なので本文から任意の id は
  // 書けず、id を作るのは remark-rehype (脚注) と KaTeX だけ
  clobberPrefix: "",
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    // アラートの目印 (docs/54 §2)。remarkAlerts が刻む `alert-<種類>` だけを
    // 通す。値の作り手はプラグインで、利用者の入力はここに入らない。
    //
    // **rehypeTaskLines (サニタイズの後に刻む) と手が違うのは意図的。**
    // あちらは既にある要素に行番号を「足す」だけなので後段でよいが、
    // アラートは目印の文字を本文から**取り除く**必要があり、それは Markdown の
    // 構文解釈そのもの — hast まで下りると段落の間の改行ノードを跨いで
    // 探すことになる。mdast で解いて class 1 つで渡すほうが素直なので、
    // その 1 つだけを許可リストに載せている
    blockquote: [
      ...(defaultSchema.attributes?.blockquote ?? []),
      ["className", new RegExp(`^${ALERT_CLASS_PREFIX}`)],
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    // blob: を許すのはシークレット断片のため (docs/51-部分暗号化計画.md §9)。
    // 断片の中に貼った画像は、復号したバイト列から Blob URL を作って
    // 差し替える — サーバは復号できないので、通常の /api/images では出せない。
    //
    // 緩めても増える攻撃面は無い: blob: URL は自分のオリジンの JS だけが
    // 作れて、本文に手で書いた blob: は何も指さない (無効な URL になる)
    src: [...(defaultSchema.protocols?.src ?? []), "blob"],
  },
} satisfies Options;

// KaTeX のオプションは葉モジュールへ移した (一覧のサーバ描画 mathText.ts と
// 共有するため。あちらがここを import すると react-markdown ごと引き込む)。
// 既存の import 元 (MarkdownView / QuizMarkdown) のためにここから再輸出する
export { KATEX_OPTIONS } from "@/lib/katexOptions";

// URL の通し方。react-markdown は**サニタイズより前に**既定の urlTransform
// (https?|ircs?|mailto|xmpp のみ許可) で URL を空文字に潰すため、
// sanitizeSchema の protocols に blob を足すだけでは足りない — シークレット
// 断片内の画像 (復号したバイト列の blob: URL。docs/51 §9) がここで消え、
// alt 文字だけが表示される (実機で発生)。
//
// blob: を通しても攻撃面は増えない: blob: URL は自分のオリジンの JS だけが
// 作れて、本文に手で書いた blob: は何も指さない (sanitizeSchema と同じ理由)。
// それ以外の未知プロトコル (javascript: 等) は今までどおり既定に任せて潰す
export function urlTransform(url: string): string {
  return url.startsWith("blob:") ? url : defaultUrlTransform(url);
}

// 外部サイトへのリンクだけ別タブで開く。#タグ の検索リンクやメモへの
// 内部リンク (/... で始まる) までタブを増やすと使いにくいため除く。
// mailto: などもメーラーが起動して空タブが残るだけなので対象外
function isExternalLink(href: string | undefined): boolean {
  return /^https?:\/\//i.test(href ?? "");
}

// react-markdown はカスタムコンポーネントに hast の node を渡してくるため、
// DOM 要素へ spread する前に取り除く
export function linkWithTarget({
  node: _node,
  children,
  ...props
}: ComponentProps<"a"> & { node?: unknown }): ReactNode {
  // rel="noreferrer" は noopener を兼ねるため、別タブでも opener は渡らない。
  // 参照元 (ノートの URL) を外部サイトに知らせないためでもある
  const target = isExternalLink(props.href) ? "_blank" : undefined;
  return (
    <a {...props} className="break-all" rel="noreferrer" target={target}>
      {children}
    </a>
  );
}
