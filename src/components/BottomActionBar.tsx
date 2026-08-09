"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import {
  ImageSearchIcon,
  ScanIcon,
  SelectIcon,
} from "@/components/MenuIcons";
import { useSelectMode } from "@/components/SelectModeProvider";
import { SlotIcon } from "@/components/SlotIcon";
import { SortSlot } from "@/components/SortSlot";
import {
  BOTTOM_BAR_CLASS,
  BOTTOM_BAR_INNER_CLASS,
  BOTTOM_BAR_SLOT_CLASS,
  BOTTOM_BAR_SPACER_CLASS,
} from "@/components/ui";
import { ViewSlot } from "@/components/ViewSlot";
import { SEARCH_SORT_SPEC } from "@/lib/sortDirection";
import { SORT_COOKIE } from "@/lib/sortMode";
import type { Sort } from "@/lib/validation";
import type { ViewMode } from "@/lib/viewMode";

// cookie を書くサーバーアクション。db.ts を巻き込まないよう prop で受ける
// (ItemList / ViewModeToggle と同じ理由)
type ViewModeAction = (formData: FormData) => void | Promise<void>;

interface BottomActionBarProps {
  query: string;
  sort: Sort;
  view: ViewMode;
  viewAction: ViewModeAction;
  // 並び順を cookie に覚えて遷移するサーバーアクション (viewAction と同じ理由で prop)
  sortAction: ViewModeAction;
  // QR シールに焼かれているホスト。ScannerModal へ渡す
  stickerHost: string;
  // 非本番はヘッダーと同じくピンクに塗る。process.env はクライアントに
  // 渡らないのでサーバから降ろす (layout.tsx と同じ判断)
  isProd: boolean;
}

// スキャナ・画像検索はカメラと重いエンジン (wasm 約 1MB / 埋め込みモデル数十MB)
// を抱えるので、ボタンを押すまで一切読み込まない
// (docs/09-スキャン計画.md §2、docs/25-画像検索計画.md)。
// 以前は SearchForm が持っていたが、ボタンがこのバーへ移ったので所有権も移す。
// ssr: false … camera / document を触るのでサーバでは描画できない
const ScannerModal = dynamic(
  () => import("@/components/ScannerModal").then((m) => m.ScannerModal),
  { ssr: false },
);

const ImageSearchModal = dynamic(
  () => import("@/components/ImageSearchModal").then((m) => m.ImageSearchModal),
  { ssr: false },
);

// 検索画面の主要操作を画面下端にまとめた固定バー (docs/31-下部操作バー計画.md)。
//
// 片手持ちの親指が届くのは画面の下側で、届きにくいのは左右ではなく高さ
// (docs/11-アプリ的UIUX計画.md §8-4 でハンバーガーメニューをボトムシートに
// したのと同じ理由)。散っていた 3 行 (検索窓の行・件数の行・一覧の直上) を
// 1 本に集約し、空いた縦幅を一覧の件数に回す。
//
// 5 スロットはアイコン + 小ラベルの等幅。テキストボタンのまま並べると
// 実測で 450px 必要になり 320px にも 375px にも入らない (docs/31 §3-1)。
//
// 表示・並び順の 2 スロットは ViewSlot / SortSlot に切り出してある。
// ゴミ箱のバー (TrashActionBar) が同じ物を出すため
// (docs/67-ゴミ箱表示形式計画.md §4)。
export function BottomActionBar({
  query,
  sort,
  view,
  viewAction,
  sortAction,
  stickerHost,
  isProd,
}: BottomActionBarProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [isImageSearching, setIsImageSearching] = useState(false);
  const { selectMode, enter, exit } = useSelectMode();
  // 長押しで開いている選択メニュー (docs/62-下部バー長押し計画.md)。
  // 1 つの state で持つので、二枚同時に開くことはない
  const [openMenu, setOpenMenu] = useState<"view" | "sort" | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const openView = useCallback(() => setOpenMenu("view"), []);
  const openSort = useCallback(() => setOpenMenu("sort"), []);

  return (
    <>
      {/* バーぶんの余白。これがないと一覧の最終行とページ送りがバーに隠れる */}
      <div aria-hidden className={BOTTOM_BAR_SPACER_CLASS} />

      <nav
        aria-label="操作"
        className={`${BOTTOM_BAR_CLASS} ${
          isProd ? "border-gray-200 bg-white/95" : "border-pink-300 bg-pink-100/95"
        }`}
      >
        <div className={BOTTOM_BAR_INNER_CLASS}>
          {/* 戻る/進む (◀ ▶) はここにあったが、ヘッダーへ移した
              (docs/11 §5-2)。5 スロットだけの帯に戻る */}
          {/* カメラ非対応の環境でも隠さない。押したとき理由を出す方が
              原因を追える (docs/09-スキャン計画.md §6) */}
          <button
            type="button"
            onClick={() => setIsScanning(true)}
            className={`${BOTTOM_BAR_SLOT_CLASS} text-gray-700`}
          >
            <SlotIcon color="text-sky-600">
              <ScanIcon />
            </SlotIcon>
            スキャン
          </button>

          {/* 部品を映して登録済みの写真と照合する (docs/25-画像検索計画.md) */}
          <button
            type="button"
            onClick={() => setIsImageSearching(true)}
            className={`${BOTTOM_BAR_SLOT_CLASS} text-gray-700`}
          >
            <SlotIcon color="text-violet-600">
              <ImageSearchIcon />
            </SlotIcon>
            画像検索
          </button>

          <ViewSlot
            view={view}
            action={viewAction}
            open={openMenu === "view"}
            onOpen={openView}
            onClose={closeMenu}
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
          />

          {/* 一括タグ付け・ゴミ箱行きのための選択モード。一覧側 (ItemList) と
              状態を共有するので context 経由で切り替える */}
          <button
            type="button"
            onClick={selectMode ? exit : enter}
            aria-pressed={selectMode}
            className={`${BOTTOM_BAR_SLOT_CLASS} ${
              selectMode ? "bg-blue-600 text-white" : "text-gray-700"
            }`}
          >
            {/* 選択中はスロットごと bg-blue-600 + text-white へ反転する。
                色を足さず親の text-white を継がせる (blue のまま置くと
                青地に青で沈む) */}
            <SlotIcon color={selectMode ? "" : "text-blue-600"}>
              <SelectIcon />
            </SlotIcon>
            選択
          </button>
        </div>
      </nav>

      {/* モーダルは **nav の外** に置く。nav は backdrop-blur を持ち、
          backdrop-filter のある要素は position:fixed の包含ブロックになるため、
          中に入れると inset-0 が「バーの矩形」を指して画面全体に広がらない
          (HeaderMenu が覆いとシートを portal している理由と同じ) */}
      {isScanning && (
        <ScannerModal
          stickerHost={stickerHost}
          onClose={() => setIsScanning(false)}
        />
      )}
      {isImageSearching && (
        <ImageSearchModal onClose={() => setIsImageSearching(false)} />
      )}
    </>
  );
}
