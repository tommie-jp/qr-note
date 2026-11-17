"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { Item } from "@/generated/prisma/client";
import { noteName } from "@/lib/items/noteName";
// 型は erase されるので、サーバ専用 module の型でも安全 (ItemList.tsx の注)
import type { CircuitThumbMap } from "@/lib/circuit/types";
import type { MathTextMap } from "@/lib/markdown/mathTextTypes";
import type { NotePreviewMap } from "./NotePreviewThumb";
import { itemIdFromPathname } from "@/lib/search/url";
import type { Sort } from "@/lib/validation";
import type { ViewMode } from "@/lib/prefs/viewMode";
import { BulkTagToolbar } from "../search/BulkTagToolbar";
import { ImageMasonry } from "./ImageMasonry";
import { SearchTileMenuProvider } from "./row-actions/TileActions";
import { ItemRow } from "./ItemRow";
import { usePaneMode } from "../panes/PaneModeProvider";
import type { BulkTagAction, useItemListSelection } from "./useItemListSelection";

// 検索結果リスト (ItemList) の行の組み立て。描き分けの分岐は ItemList が持つ

// ノートのペイン (docs/86 §4) に出ている番号。ペイン自身が context へ
// 流したものを見る (docs/86 §4-4) — 3 ペインでは URL が /item から
// 離れてもノートが出たままなので、pathname だけでは決まらない。
// provider の外 (ペインのない画面) では pathname に落とす
export function usePreviewItemId(): string | null {
  const pathname = usePathname();
  const { shownItemId } = usePaneMode();
  return shownItemId ?? itemIdFromPathname(pathname);
}

// 小 … 今までどおりの 1 カラムの一覧 (区切り線で仕切る)。
// 大 … カードを敷き詰めるグリッド。**カラム数は指定しない**。auto-fill に
//      任せることで、スマホは 1 列・タブレット/PC は 2 列以上と画面が決める。
//      20rem を下限にするのは、これより狭いカードではタイトルも本文 3 行も
//      読めず、密度を上げた意味が無くなるため。
//
//      下限が min(20rem, 100%) なのは必須。素の minmax(20rem, 1fr) だと、
//      器が 20rem より狭い画面 (実測: 320px 端末で器は 273px) でも列が 20rem に
//      広がり、横スクロールが出る。100% との min を取ることで、狭い画面では
//      「器いっぱいの 1 列」に畳まれる
export function listClassOf(view: ViewMode): string {
  return view === "card"
    ? "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))]"
    : "divide-y divide-gray-200 rounded border border-gray-200 bg-white";
}

// 行を描く材料 (選択モードの内外で共通)
export interface RowContext {
  itemHref: (itemId: string) => string;
  view: ViewMode;
  circuitThumbs?: CircuitThumbMap;
  mathTexts?: MathTextMap;
  notePreviews?: NotePreviewMap;
  previewItemId: string | null;
}

// 1 行ぶんの ItemRow の props (選択の印・スワイプ以外)
export function rowProps(item: Item, ctx: RowContext) {
  // 画像モードの行はない (masonry が描く)。選択モード中のフォールバックなど
  // ItemRow に流すときは compact に畳む — ItemRow に 'image' が来ないことを
  // 型 (RowViewMode) で保証する
  const rowView = ctx.view === "image" ? "compact" : ctx.view;
  return {
    item,
    href: ctx.itemHref(item.itemId),
    view: rowView,
    circuitThumb: ctx.circuitThumbs?.[item.itemId]?.[0],
    mathTitle: ctx.mathTexts?.[item.itemId]?.title,
    mathPreview: ctx.mathTexts?.[item.itemId]?.preview,
    notePreview: ctx.notePreviews?.[item.itemId],
    selected: item.itemId === ctx.previewItemId,
  };
}

// 画像モード (非選択・1 件以上) の一覧。描画は ImageMasonry に丸ごと委譲する
// (docs/32 §2)。SearchTileMenuProvider … タイルの ⋮ からゴミ箱へ入れる送信の
// 状態を、ノート単位で 1 か所に持つ (docs/107 §7)
export function masonryList({
  items,
  itemHref,
  circuitThumbs,
  mathTexts,
  previewItemId,
  trashAction,
  searchState,
}: Pick<RowContext, "itemHref" | "circuitThumbs" | "mathTexts" | "previewItemId"> & {
  items: Item[];
  trashAction: BulkTagAction;
  searchState: SearchState;
}) {
  return (
    <SearchTileMenuProvider trashAction={trashAction} searchState={searchState}>
      <ImageMasonry
        items={items}
        itemHref={itemHref}
        circuitThumbs={circuitThumbs}
        mathTexts={mathTexts}
        previewItemId={previewItemId}
        tileActions
      />
    </SearchTileMenuProvider>
  );
}

// 1 件を削除した後に戻る先 (ItemList.tsx の注)
type SearchState = { q: string; page: number; sort: Sort };

// スワイプ削除は一覧系の表示すべて (小・中・大。docs/43 §9)。画像モードは
// 非選択時に ImageMasonry へ early return するので、ここには来ない。
export function swipeOf(
  item: Item,
  view: ViewMode,
  {
    trashAction,
    searchState,
    openItemId,
    setOpenItemId,
  }: {
    trashAction: BulkTagAction;
    searchState: SearchState;
    openItemId: string | null;
    setOpenItemId: (itemId: string | null) => void;
  },
) {
  const swipeEnabled = view !== "image";
  return swipeEnabled
    ? {
        trashAction,
        searchState,
        isOpen: openItemId === item.itemId,
        onOpenChange: (open: boolean) => setOpenItemId(open ? item.itemId : null),
      }
    : undefined;
}

interface SelectListProps {
  items: Item[];
  query: string;
  page: number;
  sort: Sort;
  listClass: string;
  rows: RowContext;
  selection: ReturnType<typeof useItemListSelection>;
  trashAction: BulkTagAction;
  pinAction: BulkTagAction;
  // 該当なしの案内 (選択モードでは新規登録・ゴミ箱の導線を出さない)
  emptyState: ReactNode;
}

// 選択モードの一覧。上部に一括タグ付け/削除のツールバー、各行にチェックボックス
export function selectList({
  items,
  query,
  page,
  sort,
  listClass,
  rows,
  selection,
  trashAction,
  pinAction,
  emptyState,
}: SelectListProps) {
  const { selected, setSelected, toggle, exit, submitBulkTags, clearingTagUndo, tagUndoState } =
    selection;
  return (
    <form action={submitBulkTags} className="space-y-2">
      <input type="hidden" name="q" value={query} />
      <input type="hidden" name="page" value={page} />
      <input type="hidden" name="sort" value={sort} />
      <BulkTagToolbar
        items={items}
        selected={selected}
        tagUndo={tagUndoState}
        trashAction={clearingTagUndo(trashAction)}
        pinAction={clearingTagUndo(pinAction)}
        onSelectAll={() => setSelected(new Set(items.map((i) => i.itemId)))}
        onClear={() => setSelected(new Set())}
        onCancel={exit}
      />
      <ul className={listClass}>
        {items.map((item) => (
          <ItemRow
            key={item.itemId}
            {...rowProps(item, rows)}
            checkbox={selectCheckbox(item, selected.has(item.itemId), () => toggle(item.itemId))}
          />
        ))}
        {emptyState}
      </ul>
    </form>
  );
}

// 行の選択の印
function selectCheckbox(item: Item, checked: boolean, onChange: () => void) {
  return (
    <input
      type="checkbox"
      name="itemId"
      value={item.itemId}
      checked={checked}
      onChange={onChange}
      aria-label={`${noteName(item)}を選択`}
      className="size-4 shrink-0 self-center"
    />
  );
}
