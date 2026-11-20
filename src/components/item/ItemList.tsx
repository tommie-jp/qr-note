"use client";

import { registerCodeOf } from "@/lib/external/scanRegister";
import Link from "next/link";
import { useState } from "react";
import type { Item } from "@/generated/prisma/client";
// 値の import は不可 — components/item/NotePreviewThumb.tsx はサーバ専用 module
// (offline/circuits.ts と同じ線引き)。型は erase されるので安全。
// 回路図サムネと数式の型は、サーバ専用の circuit/thumbs.ts / markdown/mathText.ts ではなく
// 型だけの葉 (circuit/types.ts / markdown/mathTextTypes.ts) から取る
import type { CircuitThumbMap } from "@/lib/circuit/types";
import type { MathTextMap } from "@/lib/markdown/mathTextTypes";
import type { NotePreviewMap } from "./NotePreviewThumb";
import { buildItemUrl } from "@/lib/search/url";
import type { Sort } from "@/lib/validation";
import { DEFAULT_VIEW_MODE, type ViewMode } from "@/lib/prefs/viewMode";
import { ItemRow } from "./ItemRow";
import { TrashIcon } from "../icons";
import { ACTION_LINK_CLASS, PRIMARY_BUTTON_CLASS } from "../ui";
import {
  listClassOf,
  masonryList,
  type RowContext,
  rowProps,
  selectList,
  swipeOf,
  usePreviewItemId,
} from "./itemListParts";
import {
  type BulkTagAction,
  type BulkTagSubmit,
  type UndoTagAction,
  useItemListSelection,
} from "./useItemListSelection";

// サーバーアクションの型 (bulkTagAction は page.tsx から prop で受け取る) は
// useItemListSelection.ts に置いてある

interface ItemListProps {
  items: Item[];
  // 一括操作後に戻る検索状態 (hidden で持ち回す)。
  query: string;
  page: number;
  sort: Sort;
  action: BulkTagSubmit;
  undoTagAction: UndoTagAction;
  // 表示モード (docs/23-検索結果表示モード計画.md)。切替そのものは
  // 下部バーが持つので、ここは受け取って描き分けるだけ
  view?: ViewMode;
  // 選択したノートをゴミ箱へ入れる (docs/12-ゴミ箱計画.md §5)
  trashAction: BulkTagAction;
  // 選択したノートをオフラインの対象にする (docs/65-オフライン対応計画.md §7)
  pinAction: BulkTagAction;
  // 0 件の検索語をタグにした新規ノートの編集ページ。タグにできない語
  // (URL・複数語) や採番できないときは null。採番はサーバでしか引けないので
  // page.tsx から降ろす (docs/10-スキャン新規登録計画.md)
  registerHref: string | null;
  // 同じ検索条件でゴミ箱に当たった件数 (0 件検索のときだけサーバが数える)
  trashedMatches: number;
  // itemId → 描画済み回路図の SVG (docs/68-一覧回路図サムネ計画.md §5)。
  // page.tsx (サーバ) が loadCircuitThumbs で引いて降ろす。小/大は先頭 1 枚を
  // 行のサムネに、画像モードは全部をタイルに使う
  circuitThumbs?: CircuitThumbMap;
  // itemId → 数式入りタイトル/プレビューの KaTeX 済み HTML
  // (docs/69-一覧数式計画.md)。page.tsx (サーバ) が buildMathTexts で作って降ろす
  mathTexts?: MathTextMap;
  // itemId → ノート全体の縮小プレビュー (docs/71-一覧ノートプレビュー計画.md)。
  // page.tsx (サーバ) が buildNotePreviews で描いて降ろす。画像も回路図も
  // 無いノートの顔になる (優先順位は lib/items/itemRowDecor.ts の rowFace が持つ)
  notePreviews?: NotePreviewMap;
  // itemId → シークレット内検索で当たった断片のラベル (docs/131)。
  // 載っている行は「🔒 ラベル」の印を付け、検索語を付けない URL で開く
  secretLabels?: Readonly<Record<string, readonly string[]>>;
}

function emptyState(
  items: Item[],
  query: string,
  registerHref: string | null,
  trashedMatches: number,
  view: ViewMode,
) {
  if (items.length > 0) {
    return null;
  }
  return (
    // カード表示では ul が枠を持たない (グリッドの器でしかない) ので、
    // 案内は自前で枠を張り、全カラムに渡す
    <li
      className={`space-y-3 px-4 py-6 text-center text-gray-500 ${
        view === "card" ? "col-span-full rounded border border-gray-200 bg-white" : ""
      }`}
    >
      <p>該当する部品がありません</p>
      {trashedMatches > 0 && (
        // 消したノートを探して 0 件のときと、ゴミ箱のノートと同じコードを
        // 再スキャンしたときの受け皿。復元は /trash 側で行う
        // (docs/12-ゴミ箱計画.md §5)
        <p>
          <Link
            href="/trash"
            transitionTypes={["nav-forward"]}
            className={`${ACTION_LINK_CLASS} justify-center`}
          >
            <TrashIcon />
            ゴミ箱に {trashedMatches} 件の一致があります
          </Link>
        </p>
      )}
      {registerHref && (
        // 何が作られるか (#コード) を見せる。押しても編集ページが開くだけで、
        // 「更新」を押すまで DB には何も書かない
        <p>
          <Link
            href={registerHref}
            transitionTypes={["nav-forward"]}
            className={`${PRIMARY_BUTTON_CLASS} px-4`}
          >
            {/* 検索語が #付き (タグ検索の形) でも、作られるタグは 1 つ */}
            <span className="font-mono">#{registerCodeOf(query) ?? query}</span> を新規登録
          </Link>
        </p>
      )}
    </li>
  );
}

// 検索結果リスト。選択モードでは各行にチェックボックス、上部に一括タグ付け/
// 削除のツールバーを出す。モードの入り切りは下部バーの「選択」が持つ。
export function ItemList(props: ItemListProps) {
  const { items, query, page, sort, view = DEFAULT_VIEW_MODE } = props;
  const { registerHref, trashedMatches, trashAction } = props;
  // view は呼び手 (SearchResultsClient) が送った先を重ねた後の値 (docs/118 §10
  // 案 B)。**ここで useShownViewMode を重ねない** — 重ねると保存の返事が来た
  // 瞬間に送った先を捨て、一覧が一瞬もとの表示に戻っていた (docs/123 §12-10)。
  // カードの本文プレビューや数式は手元の材料で描く (無ければ素の文字。rowPreview が畳む)
  const selection = useItemListSelection(props.action, props.undoTagAction);

  // スワイプで開いている行 (docs/43-スワイプ削除計画.md)。開くのは常に 1 行
  // だけにするため、ここで一元管理する。小表示・非選択のときだけ効く。
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const previewItemId = usePreviewItemId();

  const listClass = listClassOf(view);
  // ノートへのリンクに検索状態を載せる (docs/60-学習進捗計画.md §4)。
  // 開いた先で「一覧の前後」を辿れるようにするため。検索していないときは
  // buildItemUrl が素の /item/<番号> に畳むので、今までと同じ URL になる
  //
  // シークレット内の一致の行には検索語を付けない (docs/131 §6)。通常の一覧と
  // 別物で「一覧の前後」の意味が無く、付けると開いた先の前後ナビの要求にまで
  // 語が載る
  const { circuitThumbs, mathTexts, notePreviews, secretLabels } = props;
  const itemHref = (itemId: string) =>
    buildItemUrl(itemId, secretLabels?.[itemId] ? "" : query, sort);
  const rows: RowContext = { itemHref, view, circuitThumbs, mathTexts, notePreviews, previewItemId, secretLabels };

  // 1 件を削除した後に戻る先。**戻り先を持ち回さないと素の / へ飛ばされる** —
  // trashItemsAction は最後に redirect(parseBackUrl(formData)) を呼ぶので、
  // 検索語もページも送らないと「検索して 1 件消したら全件の先頭に居た」に
  // なる。一括削除の側は BulkTagToolbar のフォームが同じ 3 つを hidden で
  // 送っており、こちらだけ抜けていた
  const searchState = { q: query, page, sort };

  // 画像モードは描画を ImageMasonry に丸ごと委譲する (docs/32 §2)。
  //
  //   0 件 (検索ヒットなし) … 該当なしの案内と新規登録/ゴミ箱の導線は
  //     画像モードでも失わない。compact の枠でそのまま出す。
  //   選択モード中 … タイルは画像単位でノート単位ではなく、画像なしノートが
  //     選択対象から漏れるので、下の compact 一覧 (rowView) に畳んで受ける。
  //     抜ければ masonry に戻る (docs/32 §5)
  if (view === "image" && !selection.selectMode) {
    if (items.length === 0) {
      return (
        <ul className={listClass}>
          {emptyState(items, query, registerHref, trashedMatches, "compact")}
        </ul>
      );
    }
    return masonryList({ items, itemHref, circuitThumbs, mathTexts, previewItemId, trashAction, searchState });
  }

  if (!selection.selectMode) {
    return (
      <ul className={listClass}>
        {items.map((item) => (
          <ItemRow
            key={item.itemId}
            {...rowProps(item, rows)}
            swipe={swipeOf(item, view, { trashAction, searchState, openItemId, setOpenItemId })}
          />
        ))}
        {emptyState(items, query, registerHref, trashedMatches, view)}
      </ul>
    );
  }

  return selectList({
    items,
    query,
    page,
    sort,
    listClass,
    rows,
    selection,
    trashAction,
    pinAction: props.pinAction,
    emptyState: emptyState(items, query, null, 0, view),
  });
}
