"use client";

import { useCallback, useState } from "react";
import { SelectIcon, SlideshowIcon } from "@/components/icons";
import { perfStart } from "@/lib/logging/perfClient";
import { useImageViewer } from "@/components/imageviewer/ImageViewerProvider";
import { useSelectMode } from "@/components/search/SelectModeProvider";
import { SlotIcon } from "@/components/bottombar/SlotIcon";
import { SortSlot } from "@/components/bottombar/SortSlot";
import { INLINE_SLOT_CLASS, SLOT_LABEL_CLASS } from "@/components/ui";
import { ViewSlot } from "@/components/bottombar/ViewSlot";
import { SEARCH_SORT_SPEC } from "@/lib/prefs/sortDirection";
import { SORT_COOKIE } from "@/lib/prefs/sortMode";
import { VIEW_MODE_COOKIE } from "@/lib/prefs/viewMode";
import type { Sort } from "@/lib/validation";
import type { ViewMode } from "@/lib/prefs/viewMode";

// cookie を書くサーバーアクション。db.ts を巻き込まないよう prop で受ける
// (BottomActionBar と同じ理由)
type SlotAction = (formData: FormData) => void | Promise<void>;

interface ResultsToolbarProps {
  query: string;
  sort: Sort;
  view: ViewMode;
  viewAction: SlotAction;
  sortAction: SlotAction;
  // 「スライドショー」を出すか (docs/117 §1)。画像表示で、一覧に画像が
  // あるときだけ立てる — 押しても何も起きない釦を置かない
  slideshow?: boolean;
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
  slideshow = false,
}: ResultsToolbarProps) {
  const { selectMode, enter, exit } = useSelectMode();
  // provider の外 (オフライン一覧など) では出さない
  const viewer = useImageViewer();
  // 長押しで開いているメニュー。1 つの state で持つので二枚同時には開かない
  // (下部バーと同じ作り)
  const [openMenu, setOpenMenu] = useState<"view" | "sort" | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  // 表示モードの切替は Server Action で、cookie を書いたあと一覧を描き直す。
  // 「切替が遅い」を測るため、押した瞬間に計測を始める (docs/120 §2)。
  // 計測中でなければ perfStart は何もしない
  const measuredViewAction = useCallback(
    (formData: FormData) => {
      perfStart("表示", "/", undefined, [
        ["切替", `${view}→${String(formData.get(VIEW_MODE_COOKIE) ?? "")}`],
      ]);
      return viewAction(formData);
    },
    [view, viewAction],
  );
  const openView = useCallback(() => setOpenMenu("view"), []);
  const openSort = useCallback(() => setOpenMenu("sort"), []);

  return (
    // ml-auto … 件数と補助リンクは左、操作は右。間が空くので、読む物と
    // 押す物が混ざらない。
    // shrink-0 … 詰まったときに譲るのは件数の側 (あちらは truncate する)。
    // ここが縮むと、狭いペインで操作そのものが読めなくなる
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {/* 一覧の先頭の画像から全画面で流す。選択中は出さない (選択モードは
          一覧のどこを押しても選択にする流儀。docs/116 §1) */}
      {slideshow && viewer !== null && !selectMode && (
        <button
          type="button"
          onClick={() => viewer.startSlideshow()}
          aria-label="スライドショー"
          title="スライドショー"
          className={`${INLINE_SLOT_CLASS} text-gray-700`}
        >
          <SlotIcon color="text-indigo-600">
            <SlideshowIcon />
          </SlotIcon>
          <span className={SLOT_LABEL_CLASS}>スライドショー</span>
        </button>
      )}
      <ViewSlot
        view={view}
        action={measuredViewAction}
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
