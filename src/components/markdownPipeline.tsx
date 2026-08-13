// markdown を描くときの共有部品 — サニタイズ規則・URL の通し方・プラグイン列・
// リンクの描き方・フェンス読み・添付 URL の振り分け・アラート引用
// (MarkdownView から切り出し)。
//
// 切り出したのは、本文の一部を**入れ子で描く**部品ができたから
// (```quiz フェンスの問題文・選択肢・解説。docs/58-CBT問題集計画.md §2)。
// MarkdownView から直接 import すると、MarkdownView → QuizFence →
// MarkdownView の循環参照になる。規則そのものはどちらから見ても同じなので、
// MarkdownView より下の層としてここに置く (循環しない・server/client どちら
// からも安全 — "use client" も hook も持たない部品しか import しないこと)。
// 一覧のノート全体プレビュー (NotePreviewThumb.tsx。
// docs/71-一覧ノートプレビュー計画.md) も同じ規則で描くため、ここを共有する。
//
// **入れ子側でも同じものを使うこと**が要点 — 別に緩い規則を持つと、本文では
// 通らない書き方がフェンスの中だけ通る穴になる。リンクの rel も同じで、
// 入れ子だけ素の <a> だと参照元 (ノートの URL) が外部サイトへ漏れる。

import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { defaultUrlTransform } from "react-markdown";
import type { PluggableList } from "unified";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema, type Options } from "rehype-sanitize";
import { ALERT_CLASS_PREFIX, alertTypeFromClassName } from "./remarkAlerts";
import { BASE_REMARK_PLUGINS } from "./remarkPlugins";
import { MarkdownAlert } from "./MarkdownAlert";
import { KATEX_OPTIONS } from "@/lib/katexOptions";
import { ANSWER_SPOILER_CLASS } from "@/lib/answerSpoiler";
import { AnswerSpoiler } from "./answer/AnswerSpoiler";

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
    // 答え隠しの目印 (docs/79)。remarkAnswerSpoiler が刻む class 1 つだけを
    // 通す。アラートと同じ作法で、値の作り手はプラグイン側
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", ANSWER_SPOILER_CLASS],
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

// KaTeX のオプションは葉モジュールに置いてある (一覧のサーバ描画 mathText.ts
// と共有するため。あちらがここを import すると react-markdown ごと引き込む)。
// 既存の import 元 (MarkdownView / QuizMarkdown) のためにここから再輸出する
export { KATEX_OPTIONS };

// 本文とプレビューが共有するプラグイン列の土台 (docs/71 §4)。
//
// **remark 側の正本は remarkPlugins.ts。** ページの区切りを読む notePages.ts が
// 同じ列を使うため、あちらから import できる葉に置いてある (ここを import
// させると react-markdown 一式が編集画面の束に降る)。既存の import 元の
// ためにここから再輸出する。
//
// rehype は sanitize → katex の順 — ユーザー入力は sanitize 済み・KaTeX が
// 生成した HTML はそのまま残る (remark-math 公式レシピ)。
//
// 消費側が足すもの: MarkdownView は remarkTagLinks (タグをリンクに) と
// rehypeTaskLines (チェックボックスの行番号) を後ろに足す。プレビューは
// 押せる物を作らないので土台のまま使う
export { BASE_REMARK_PLUGINS };
export const BASE_REHYPE_PLUGINS: PluggableList = [
  [rehypeSanitize, sanitizeSchema],
  [rehypeKatex, KATEX_OPTIONS],
];

// 脚注まわりの文言 (docs/54 §3)。既定は英語の "Footnotes" で、隠し見出しに
// 付く sr-only class はサニタイズで落ちるため画面に出る — 本文でも
// プレビューでも同じ日本語を出す
export const REMARK_REHYPE_OPTIONS = {
  footnoteLabel: "脚注",
  footnoteBackLabel: "本文に戻る",
};

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
// DOM 要素へ spread する前に取り除く。カスタムレンダラを持つ描画側
// (MarkdownView / NotePreviewThumb) が共通に使う props 型
export type MarkdownComponentProps<
  T extends "pre" | "a" | "img" | "input" | "blockquote" | "span",
> = ComponentProps<T> & {
  node?: unknown;
};

// フェンスの言語と中身を取り出す。<pre> の中が <code> でなければ null。
// **言語指定がなければ lang は null** (字下げのコードブロックもここに来る) —
// コピーボタンは言語の有無によらず出したいので、言語なしを弾かない
export function readFence(
  children: ReactNode,
): { lang: string | null; code: string } | null {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return null;
  }
  const lang =
    /\blanguage-([^\s]+)/.exec(child.props.className ?? "")?.[1] ?? null;
  const code = Children.toArray(child.props.children)
    .filter((c): c is string => typeof c === "string")
    .join("");
  return { lang, code: code.trim() };
}

// 添付 URL の振り分け (classifyImgSrc) は @/lib/imgSrcKind へ移した。
// 編集画面の添付チップ (client) からも読むためで、経緯は移設先の冒頭に書いた。
// ここから re-export はしない — 消費側が置き場を直に指すほうが、
// 「これは Server Component 用の入れ物」という境界が保たれる

// alt の幅記法の解釈 (parseAltWidth) は @/lib/altWidth へ移した。
// classifyImgSrc と同じく編集画面の添付チップ (client) からも読むためで、
// 経緯は移設先の冒頭に書いた。ここから re-export はしない

// 答え隠し (docs/79) の span を、押して開く部品に差し替える。
//
// **KaTeX が作る span もここを通る** — 数式は sanitize の後に rehype-katex が
// 作るので class を保ったまま届く。目印を持たない span は素のまま返すこと
// (props をそのまま流す)。
export function spanWithAnswer({
  node: _node,
  children,
  ...props
}: MarkdownComponentProps<"span">) {
  const className = typeof props.className === "string" ? props.className : "";
  if (className.split(/\s+/).includes(ANSWER_SPOILER_CLASS)) {
    return <AnswerSpoiler>{children}</AnswerSpoiler>;
  }
  return <span {...props}>{children}</span>;
}

// remarkAlerts が刻んだ class を読んでアラートの枠に差し替える (docs/54 §2)。
// 目印の無い引用 (知らない種類の `[!FOO]` を含む) はただの引用のまま
export function blockquoteWithAlert({
  node: _node,
  children,
  className,
  ...props
}: MarkdownComponentProps<"blockquote">) {
  const type = alertTypeFromClassName(className);
  if (type === null) {
    return <blockquote {...props}>{children}</blockquote>;
  }
  return <MarkdownAlert type={type}>{children}</MarkdownAlert>;
}

export function linkWithTarget({
  node: _node,
  children,
  ...props
}: MarkdownComponentProps<"a">): ReactNode {
  // rel="noreferrer" は noopener を兼ねるため、別タブでも opener は渡らない。
  // 参照元 (ノートの URL) を外部サイトに知らせないためでもある
  const target = isExternalLink(props.href) ? "_blank" : undefined;
  return (
    <a {...props} className="break-all" rel="noreferrer" target={target}>
      {children}
    </a>
  );
}
