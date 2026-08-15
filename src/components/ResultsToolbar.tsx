"use client";

import { useCallback, useState } from "react";
import { SelectIcon } from "@/components/MenuIcons";
import { useSelectMode } from "@/components/SelectModeProvider";
import { SlotIcon } from "@/components/SlotIcon";
import { SortSlot } from "@/components/SortSlot";
import { INLINE_SLOT_CLASS, SLOT_LABEL_CLASS } from "@/components/ui";
import { ViewSlot } from "@/components/ViewSlot";
import { SEARCH_SORT_SPEC } from "@/lib/sortDirection";
import { SORT_COOKIE } from "@/lib/sortMode";
import type { Sort } from "@/lib/validation";
import type { ViewMode } from "@/lib/viewMode";

// cookie を書くサーバーアクション。db.ts を巻き込まないよう prop で受ける
// (BottomActionBar と同じ理由)
type SlotAction = (formData: FormData) => void | Promise<void>;

interface ResultsToolbarProps {
  query: string;
  sort: Sort;
  view: ViewMode;
  viewAction: SlotAction;
  sortAction: SlotAction;
}

// 検索結果の見出し行 (件数の右) に並べる操作 (docs/86 §4-11)。
//
// 表示・並び順・選択は**一覧に効く操作**なので、一覧の頭に置く。
// 画面下端のバーに置いていた頃は、3 ペインだとバーが画面の一番下 =
// ノートのペインの下にあり、どのペインに効くのか判らなかった。
// バーに残るのはスキャンと画像検索 — どちらも一覧とは無関係に押せる入口。
//
// 中身は下部バーとまったく同じ部品 (ViewSlot / SortSlot) の variant 違い。
// 循環・長押しメニュー・JS 無効での送信は BarSlot 側に置いたまま共有する。
export function ResultsToolbar({
  query,
  sort,
  view,
  viewAction,
  sortAction,
}: ResultsToolbarProps) {
  const { selectMode, enter, exit } = useSelectMode();
  // 長押しで開いているメニュー。1 つの state で持つので二枚同時には開かない
  // (下部バーと同じ作り)
  const [openMenu, setOpenMenu] = useState<"view" | "sort" | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const openView = useCallback(() => setOpenMenu("view"), []);
  const openSort = useCallback(() => setOpenMenu("sort"), []);

  return (
    // ml-auto … 件数と補助リンクは左、操作は右。間が空くので、読む物と
    // 押す物が混ざらない。
    // shrink-0 … 詰まったときに譲るのは件数の側 (あちらは truncate する)。
    // ここが縮むと、狭いペインで操作そのものが読めなくなる
    <span className="ml-auto flex shrink-0 items-center gap-1">
      <ViewSlot
        view={view}
        action={viewAction}
        open={openMenu === "view"}
        onOpen={openView}
        onClose={closeMenu}
        variant="inline"
      />
      {/* 検索語は hidden で持ち回す (並び替えで検索語が消えては困る) */}
      <SortSlot
        spec={SEARCH_SORT_SPEC}
        sort={sort}
        action={sortAction}
        cookieName={SORT_COOKIE}
        hidden={<input type="hidden" name="q" value={query} />}
        open={openMenu === "sort"}
        onOpen={openSort}
        onClose={closeMenu}
        variant="inline"
      />
      {/* 一括タグ付け・ゴミ箱行きのための選択モード。一覧側 (ItemList) と
          状態を共有するので context 経由で切り替える */}
      <button
        type="button"
        onClick={selectMode ? exit : enter}
        aria-pressed={selectMode}
        className={`${INLINE_SLOT_CLASS} ${
          selectMode ? "bg-blue-600 text-white" : "text-gray-700"
        }`}
      >
        {/* 選択中はスロットごと反転する。色を足さず親の text-white を
            継がせる (blue のまま置くと青地に青で沈む) */}
        <SlotIcon color={selectMode ? "" : "text-blue-600"}>
          <SelectIcon />
        </SlotIcon>
        {/* 狭いペインでは「選」まで削る (表示・並び順と同じ。ui.ts の
            SLOT_LABEL_CLASS)。読み上げは aria-pressed 付きのボタン名が
            そのまま残るので、削っても意味は失われない */}
        <span className={SLOT_LABEL_CLASS}>選択</span>
      </button>
    </span>
  );
}
