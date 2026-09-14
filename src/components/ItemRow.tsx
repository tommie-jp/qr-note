import type { ReactNode } from "react";
import type { Item } from "@/generated/prisma/client";
import { ItemRowCard } from "./item/ItemRowCard";
import { ItemRowCompact } from "./item/ItemRowCompact";
import { buildRowParts } from "./item/rowParts";
import type { RowSwipe } from "./SwipeToTrashRow";
import { rowPreview, type RowViewMode } from "@/lib/items/itemRowDecor";
import { DEFAULT_VIEW_MODE } from "@/lib/prefs/viewMode";

export type { RowViewMode } from "@/lib/items/itemRowDecor";

interface ItemRowProps {
  item: Item;
  // ノートを開くリンク先。ItemList が検索状態を載せた URL を組み立てて渡し、
  // ノート側の前後ナビが「一覧のどこに居るか」を復元できるようにする
  // (docs/60-学習進捗計画.md §4)。**任意にしない**: 既定を持たせると、
  // 渡し忘れた一覧で前後ナビだけが黙って消える
  href: string;
  // 選択モードで先頭に差し込むチェックボックス (通常時は undefined)。
  checkbox?: ReactNode;
  // 表示モード (docs/23-検索結果表示モード計画.md)。既定は今までの 2 行表示。
  view?: RowViewMode;
  // スワイプ削除 (docs/43-スワイプ削除計画.md)。アクション・開閉・削除後に戻る
  // 検索状態を 1 つの袋で受ける (RowSwipe)。ItemList が一覧系の表示のときだけ
  // 降ろしてくる (docs/43 §9-4)。選択モード (checkbox あり) では渡されても使わない。
  //
  // ゴミ箱の一覧 (docs/67-ゴミ箱表示形式計画.md §3) はスワイプ削除を出さない
  // ので、検索状態ごと渡さない
  swipe?: RowSwipe;
  // 行の下に足す補助行 (ゴミ箱の削除日時と復元 / 永久削除)。
  // 押せる物を入れられるよう、stretched link の膜より前に出して描く
  footer?: ReactNode;
  // 画像サムネが無いノートの代わりの顔にする回路図
  // (docs/68-一覧回路図サムネ計画.md §3)。サーバで描画・検査済みの SVG 文字列。
  // 一覧側 (circuit/thumbs.ts) が「本文の最初に描画済みの図」を選んで降ろす。
  // **画像があるノートでは使わない** — 優先順位の分岐は lib/items/itemRowDecor.ts の rowFace が持つ
  circuitThumb?: string;
  // 数式入りのタイトル/プレビューの KaTeX 済み HTML (docs/69-一覧数式計画.md)。
  // サーバ (markdown/mathText.ts) が数式を含むノートにだけ作って降ろす。
  // 無ければ従来どおりプレーンテキスト (title / preview) で出す
  mathTitle?: string;
  mathPreview?: string;
  // 画像も回路図も無いノートの顔にする、ノート全体の縮小プレビュー
  // (docs/71-一覧ノートプレビュー計画.md)。サーバ (buildNotePreviews) が
  // 描いた ReactNode を受けて NotePreviewFrame で縮める。
  // **画像・回路図があるノートでは使わない** — 優先順位の分岐は rowFace が持つ
  notePreview?: ReactNode;
  // プレビューペイン (docs/86 §4) でこのノートが開いているか。ItemList が
  // usePathname から導いて渡す (URL が正なので、選択のための state は無い)
  selected?: boolean;
}

// 検索結果 / 一覧の 1 件。
//
//   compact … 「#番号 タイトル」の 1 行 + 右端に 1 行ぶんのサムネ。
//   medium  … + 2 行目にタグ + 少し大きいサムネ。
//   card    … + 本文プレビュー 3 行 + 大きめのサムネ。
//
// 描き分けは item/ItemRowCard (大) と item/ItemRowCompact (小・中)、共通の部品は
// item/rowParts.tsx が組み、何を出すかの判断は lib/items/itemRowDecor.ts が持つ。
//
// タイトル (memoSummary) と本文 (memoPreview) は同じ規則で切り分けてあり、
// 本文には 1 行目・タグ・プロパティ・画像が出てこない。カードの 3 行に
// 「他の場所で既に見えているもの」を流さないため (markdown/memoPreview.ts 参照)。
//
// **"use client" を付けない。** 検索一覧 (client の ItemList) とゴミ箱
// (server の TrashList) の両方から描かれるので、hooks も context も持たない。
// 押下を扱う部分は SwipeToTrashRow (client) に閉じてある
export function ItemRow({
  item,
  href,
  checkbox,
  view = DEFAULT_VIEW_MODE,
  swipe,
  footer,
  circuitThumb,
  mathTitle,
  mathPreview,
  notePreview,
  selected = false,
}: ItemRowProps) {
  const parts = buildRowParts({
    item,
    href,
    checkbox,
    view,
    footer,
    circuitThumb,
    mathTitle,
    notePreview,
    selected,
  });

  // スワイプ削除は非選択 (checkbox なし) のときだけ。選んでいる最中に
  // 行が滑ったり削除ボタンが出たりすると、選択の操作とぶつかる
  const rowSwipe = checkbox ? undefined : swipe;

  if (view === "card") {
    return (
      <ItemRowCard
        parts={parts}
        preview={rowPreview(item, mathPreview)}
        swipe={rowSwipe}
      />
    );
  }
  return <ItemRowCompact parts={parts} swipe={rowSwipe} />;
}
