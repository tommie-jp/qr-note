// 一覧のノート全体プレビュー (docs/71-一覧ノートプレビュー計画.md)。
//
// 画像も回路図も無いノートの「顔」として、本文の markdown をそのまま描き、
// NotePreviewFrame が CSS の scale で 40px/96px に縮小する。ラスタ画像は
// 作らない — 回路図サムネが SVG をインラインで埋め込む (docs/68 §3) のと
// 同じ系で、生成も保存もバックフィルも要らず常に本文どおり。
//
// **中に押せる物・client component を一切入れない**のが要点。行は
// stretched link の膜 (ItemRow) で包まれ、枠には inert を付ける前提だが、
// そもそもリンク・ボタン・プレイヤーを描かなければ事故のしようがない。
// レンダラの差し替え (PREVIEW_COMPONENTS) がその保証で、規則そのもの
// (sanitize・URL・プラグイン列・添付の判定) は本文 (MarkdownView) と
// markdownPipeline.tsx で共有する。
//
// このモジュールは react-markdown + KaTeX を引き込むサーバ専用。
// client component からは値を import しないこと (型だけなら可。
// circuitThumbs.ts / mathText.ts と同じ線引き)

import type { ReactNode } from "react";
import Markdown from "react-markdown";
import {
  BASE_REHYPE_PLUGINS,
  BASE_REMARK_PLUGINS,
  blockquoteWithAlert,
  type MarkdownComponentProps,
  readFence,
  REMARK_REHYPE_OPTIONS,
  urlTransform,
} from "./markdownPipeline";
import type { CircuitThumbMap } from "@/lib/circuitThumbs";
import { parseAltWidth } from "@/lib/altWidth";
import { classifyImgSrc } from "@/lib/imgSrcKind";
import { RENDERED_LANGS } from "@/lib/fenceLanguages";
import { attachmentNameFromUrl, thumbUrl } from "@/lib/memoImages";
import {
  NOTE_PREVIEW_COMPACT_SOURCE_CHARS,
  NOTE_PREVIEW_MAX_ITEMS,
  NOTE_PREVIEW_MAX_SOURCE_CHARS,
  notePreviewSource,
  wantsNotePreview,
} from "@/lib/notePreview";
import { DEFAULT_SECRET_LABEL } from "@/lib/secrets";
import { isValidImageName } from "@/lib/uploads";
import type { ViewMode } from "@/lib/viewMode";
import "katex/dist/katex.min.css";

// itemNo → 描画済みプレビュー。サーバ (page.tsx) が作り、client 境界を
// ReactNode のまま越えて ItemRow へ降りる (checkbox / footer と同じ機構)。
// circuitThumbs / mathTexts と違い文字列ではないので、バイト予算ではなく
// 件数 (NOTE_PREVIEW_MAX_ITEMS) とソース切り詰めで重さを抑える
export type NotePreviewMap = Record<string, ReactNode>;

// 図・カードのフェンス (mermaid / circuitikz / quiz) の代役。mermaid は
// ブラウザでしか描けず (MermaidDiagram は client + 動的 import)、一覧に
// スピナーを 60 個並べるわけにもいかないので、Phase 1 は形だけ示す。
// 回路図は普段ここへ来ない (キャッシュ済みなら優先順位 2 の CircuitThumb が
// 受ける) — 来るのは未描画・検査 NG の図の受け皿
function FencePlaceholder() {
  return (
    <div
      className="fence-placeholder flex h-24 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-gray-300"
      role="presentation"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <rect x="3" y="3" width="7" height="6" rx="1" />
        <rect x="14" y="15" width="7" height="6" rx="1" />
        <path d="M6.5 9v6a3 3 0 0 0 3 3H14" />
      </svg>
    </div>
  );
}

// 音声・動画・PDF・外部画像などの代役チップ。開く・再生するの導線は持たず、
// 「何が添付されているか」だけを縮小後も判る形で示す
function MediaChip({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-gray-500">
      <span aria-hidden>{icon}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}

function previewPre({
  node: _node,
  children,
  ...props
}: MarkdownComponentProps<"pre">) {
  const fence = readFence(children);
  if (
    fence?.lang &&
    (RENDERED_LANGS as readonly string[]).includes(fence.lang)
  ) {
    return <FencePlaceholder />;
  }
  // 普通のコードは文字のまま見せる。CodeBlock (コピーボタン付き) は使わない
  return <pre {...props}>{children}</pre>;
}

// リンクは文字だけ残す。href を持たせないのは stretched link の膜の
// 下でフォーカス可能な要素を作らないため (見た目はリンク風のまま)
function previewLink({ children }: MarkdownComponentProps<"a">) {
  return <span className="text-blue-700 underline">{children}</span>;
}

// 画像記法の振り分け。判定は classifyImgSrc (markdownPipeline.tsx) に
// 一本化してあり、ここが持つのは「種別 → 押せない代役」の対応だけ。
// 差し替え先がすべて「押せない・取得しに行かない」物になるのがプレビューの流儀
function previewImg({
  node: _node,
  alt,
  ...props
}: MarkdownComponentProps<"img">) {
  const src = typeof props.src === "string" ? props.src : "";
  const cls = classifyImgSrc(src);
  const label = parseAltWidth(alt).label;
  // シークレット断片は復号内容どころか解錠 UI (SecretBlock) ごと出さない —
  // プレビューは誰の目にも入る一覧に並ぶので、伏せ字チップまでで止める
  if (cls.kind === "secret") {
    return <MediaChip icon="🔒" label={alt || DEFAULT_SECRET_LABEL} />;
  }
  if (cls.kind === "audio") {
    return <MediaChip icon="♪" label={label || "音声"} />;
  }
  if (cls.kind === "video") {
    // 動画はチップまで。poster (?thumb=1) を <img> で出すと、poster の無い
    // 動画 (iOS 旧録画・生成失敗) で 404 の壊れた画像アイコンになる —
    // RowThumb の onError による差し替えはサーバ描画のここでは使えない
    return <MediaChip icon="▶" label={label || "動画"} />;
  }
  if (cls.kind === "pdf") {
    return <MediaChip icon="📄" label={label || "PDF"} />;
  }
  if (cls.kind === "text") {
    return <MediaChip icon="📄" label={label || "テキスト"} />;
  }
  // 自前の画像は縮小版 (?thumb=1) で出す。ここへ来るのは稀 (絵のあるノートは
  // 優先順位 1 の RowThumb が受ける) だが、書式外れ (タイトル付き記法など) と
  // 共存する本文の受け皿として本物を描いておく
  const name = attachmentNameFromUrl(src);
  if (name !== null && isValidImageName(name)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbUrl(name)}
        alt=""
        loading="lazy"
        decoding="async"
        className="max-w-full"
      />
    );
  }
  // 外部画像 (https://…) など。一覧を開くだけで外部へ要求を飛ばさない
  // (memoImages.ts が外部画像をサムネにしないのと同じ方針)
  return <MediaChip icon="🖼" label={label || "画像"} />;
}

// 本文と同じ解釈 (markdownPipeline.tsx の土台をそのまま使う)。本文が足す
// 2 つ (remarkTagLinks / rehypeTaskLines) はここでは足さない — タグを
// リンクにせず、チェックボックスは GFM 既定の disabled のままにするため
const PREVIEW_COMPONENTS = {
  pre: previewPre,
  img: previewImg,
  a: previewLink,
  blockquote: blockquoteWithAlert,
};

// 縮小前のキャンバスに入れる中身。markdown は notePreviewSource で
// 切り詰め済みの想定 (このコンポーネントは切らない — 描き方だけを持つ)
export function NotePreviewThumb({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words px-2 py-1 [&_li.task-list-item]:list-none">
      <Markdown
        remarkPlugins={BASE_REMARK_PLUGINS}
        urlTransform={urlTransform}
        rehypePlugins={BASE_REHYPE_PLUGINS}
        remarkRehypeOptions={REMARK_REHYPE_OPTIONS}
        components={PREVIEW_COMPONENTS}
      >
        {markdown}
      </Markdown>
    </div>
  );
}

// ページ内アイテムのプレビューをまとめて作る。DB は引かない同期処理
// (buildMathTexts と同じ)。**loadCircuitThumbs の後に呼ぶこと** — 回路図
// サムネが出るノートに作っても使われず、パースが丸ごと無駄になる。
//
// view を受けるのは buildMathTexts / loadCircuitThumbs と同じ作法:
//   image … 行が無い (ImageMasonry がタイルを描く) ので作らない
//   compact … 40px では文字が模様にしかならないので、ソースをさらに足切り
export function buildNotePreviews(
  items: readonly { itemNo: string; memo: string; mode: string }[],
  circuitThumbs: CircuitThumbMap,
  view: ViewMode,
): NotePreviewMap {
  if (view === "image") {
    return {};
  }
  const maxChars =
    view === "compact"
      ? NOTE_PREVIEW_COMPACT_SOURCE_CHARS
      : NOTE_PREVIEW_MAX_SOURCE_CHARS;
  // 上限から先は黙って作らない (一覧の後ろのページほど文字だけに戻る。
  // CIRCUIT_THUMB_BUDGET と同じ「先頭から詰める」約束)。
  // 回路図の判定は ItemRow の分岐 (?.[0]) と同じ形にする — 片方が
  // 「図あり」もう片方が「図なし」と読むと、顔が 1 つも出ない行ができる
  const targets = items
    .filter(
      (item) => wantsNotePreview(item) && !circuitThumbs[item.itemNo]?.[0],
    )
    .slice(0, NOTE_PREVIEW_MAX_ITEMS);
  return Object.fromEntries(
    targets.map((item) => [
      item.itemNo,
      <NotePreviewThumb key={item.itemNo} markdown={notePreviewSource(item.memo, maxChars)} />,
    ]),
  );
}
