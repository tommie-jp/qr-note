"use client";

import { useCallback, useState } from "react";
import { SortSlot } from "@/components/SortSlot";
import {
  BOTTOM_BAR_CLASS,
  BOTTOM_BAR_INNER_NARROW_CLASS,
  BOTTOM_BAR_SPACER_CLASS,
} from "@/components/ui";
import { ViewSlot } from "@/components/ViewSlot";
import { TRASH_SORT_SPEC } from "@/lib/sortDirection";
import { TRASH_SORT_COOKIE } from "@/lib/sortMode";
import type { TrashSort } from "@/lib/validation";
import type { ViewMode } from "@/lib/viewMode";

type SlotAction = (formData: FormData) => void | Promise<void>;

interface TrashActionBarProps {
  view: ViewMode;
  sort: TrashSort;
  viewAction: SlotAction;
  sortAction: SlotAction;
  // 非本番はヘッダー・検索画面のバーと同じくピンクに塗る
  isProd: boolean;
}

// ゴミ箱の下部バー (docs/67-ゴミ箱表示形式計画.md §4)。
//
// **検索画面と同じ 2 スロットを同じ位置に出す。** 表示形式と並び順は
// 「一覧をどう見るか」の操作で、画面が変わるたびに置き場所が動くと探す羽目に
// なる。中身 (ViewSlot / SortSlot) も同じ部品をそのまま使う。
//
// 出さないスロットが 3 つある。スキャン・画像検索はゴミ箱に当たっても
// 開けないノートを指すだけで、押す意味がない。選択モードは行ごとの
// 復元 / 永久削除で足りている (docs/12-ゴミ箱計画.md §5 の判断のまま)。
export function TrashActionBar({
  view,
  sort,
  viewAction,
  sortAction,
  isProd,
}: TrashActionBarProps) {
  // 開いているメニューは 1 つ (検索画面のバーと同じ持ち方)
  const [openMenu, setOpenMenu] = useState<"view" | "sort" | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const openView = useCallback(() => setOpenMenu("view"), []);
  const openSort = useCallback(() => setOpenMenu("sort"), []);

  return (
    <>
      {/* バーぶんの余白。これがないと一覧の最終行がバーに隠れる */}
      <div aria-hidden className={BOTTOM_BAR_SPACER_CLASS} />

      {/* data-bottom-bar … 「帯が出ている」の目印 (PageBottomBar と同じ。
          globals.css の body:has が --bottom-bar-h を 49px にする) */}
      <nav
        aria-label="ゴミ箱の操作"
        data-bottom-bar
        className={`${BOTTOM_BAR_CLASS} ${
          isProd ? "border-gray-200 bg-white/95" : "border-pink-300 bg-pink-100/95"
        }`}
      >
        <div className={BOTTOM_BAR_INNER_NARROW_CLASS}>
          <ViewSlot
            view={view}
            action={viewAction}
            open={openMenu === "view"}
            onOpen={openView}
            onClose={closeMenu}
          />
          {/* 検索窓が無いので hidden は要らない */}
          <SortSlot
            spec={TRASH_SORT_SPEC}
            sort={sort}
            action={sortAction}
            cookieName={TRASH_SORT_COOKIE}
            open={openMenu === "sort"}
            onOpen={openSort}
            onClose={closeMenu}
          />
        </div>
      </nav>
    </>
  );
}
