"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  GridViewIcon,
  ImageSearchIcon,
  ImageViewIcon,
  ListViewIcon,
  ScanIcon,
  SelectIcon,
  SortIcon,
} from "@/components/MenuIcons";
import { HistoryNav } from "@/components/HistoryNav";
import { useSelectMode } from "@/components/SelectModeProvider";
import { SlotMenu } from "@/components/SlotMenu";
import {
  BOTTOM_BAR_CLASS,
  BOTTOM_BAR_INNER_CLASS,
  BOTTOM_BAR_SLOT_CLASS,
  BOTTOM_BAR_SPACER_CLASS,
  SLOT_MENU_ITEM_CLASS,
} from "@/components/ui";
import { useLongPress } from "@/components/useLongPress";
import { SORT_COOKIE } from "@/lib/sortMode";
import type { Sort } from "@/lib/validation";
import { VIEW_MODE_COOKIE, type ViewMode } from "@/lib/viewMode";

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

// スロットごとの機能色 (docs/31-下部操作バー計画.md §11-1)。
// ラベルを読まなくても色と形で狙えるようにする。色をアイコン側ではなく
// ここから与えるのは、選択スロットが押下中に白へ反転するため — 反転を知って
// いるのはこの部品だけで、currentColor 経由なら text-white がそのまま勝つ。
// ラベルの文字は塗らない。0.625rem を 5 色に塗るとうるさく、読みにくくなる
function SlotIcon({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  // flex … span を inline のまま置くと svg の下にベースラインぶんの隙間が出る
  return <span className={`flex ${color}`}>{children}</span>;
}

// 長押しメニューの行頭に置く「いまこれ」の印 (docs/62 §3)。
//
// 現在値でも枠や背景を塗らない。3 行のうち 1 行が塗られていると、それが
// 「選ばれている」ではなく「押せる主ボタン」に見える。選んでいない行にも
// 同じ幅を空けるのは、印の有無でラベルの左端がずれないようにするため
function MenuCheck({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className="w-4 shrink-0 text-center text-blue-600">
      {checked ? "✓" : ""}
    </span>
  );
}

// 検索画面の主要操作を画面下端にまとめた固定バー (docs/31-下部操作バー計画.md)。
//
// 片手持ちの親指が届くのは画面の下側で、届きにくいのは左右ではなく高さ
// (docs/11-アプリ的UIUX計画.md §8-4 でハンバーガーメニューをボトムシートに
// したのと同じ理由)。散っていた 3 行 (検索窓の行・件数の行・一覧の直上) を
// 1 本に集約し、空いた縦幅を一覧の件数に回す。
//
// 5 スロットはアイコン + 小ラベルの等幅。テキストボタンのまま並べると
// 実測で 450px 必要になり 320px にも 375px にも入らない (docs/31 §3-1)。
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
  // メニューの行を選んだときの閉じ方。**その場で閉じてはいけない。**
  //
  // 行はフォームの submit ボタンで、送信はクリックの既定動作として
  // 後から走る。onClick で state を倒すと React はその場で再描画して
  // ボタンを DOM から外し、外れたボタンは form owner を失う。仕様上
  // form を持たない submit ボタンは何もしないので、**メニューで選んでも
  // 表示モードが変わらない**という形で出た (押した手応えだけがある)。
  // 0ms の setTimeout は「いまのタスクが終わってから」の意味で、
  // 送信が起動した後に閉じる。microtask では早すぎる — リスナーが
  // 返った時点で 1 度流れるので、既定動作より前に来てしまう
  const closeAfterSubmit = useCallback(() => {
    setTimeout(closeMenu, 0);
  }, [closeMenu]);
  const viewPress = useLongPress(() => setOpenMenu("view"));
  const sortPress = useLongPress(() => setOpenMenu("sort"));
  // メニューを開いたボタン。SlotMenu が「外側の押下」からこの的を除くのに使う
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  // スロットを押したときの振り分け。**見る順番が要点**で、
  //
  //   1. 長押しを終えた指離し … 何もしない (メニューは開いたまま)
  //   2. 開いている間のタップ … 閉じるだけ。循環はさせない
  //   3. それ以外            … 今までどおり次の値へ循環 (送信を素通し)
  //
  // 1 を先に見ないと、メニューを出した指を離しただけでそれが 2 と見なされ、
  // 開いた瞬間に閉じる (長押しが効かないように見える)。
  // 2 が要るのは、開いたスロットをもう一度押すのが「メニューを引っ込めたい」
  // であって「次のモードにしたい」ではないから — 送信まで通すと、消すつもりの
  // タップで表示モードが 1 つ進む。閉じる的をボタン自身に持たせられるのは、
  // SlotMenu 側がこのボタンへの押下を「外側」から除いているため
  const dismissOrCycle = (
    event: React.MouseEvent,
    which: "view" | "sort",
    onClick: (event: React.MouseEvent) => boolean,
  ) => {
    if (onClick(event)) {
      return;
    }
    if (openMenu === which) {
      event.preventDefault();
      closeMenu();
    }
  };

  // 表示は 小→大→画像 の 3 値を 1 スロットで循環するトグル (docs/32 §3)、
  // 並び順は 2 択のトグル。どちらもセグメントにはしない。ラベルには
  // **現在の値**を出す — ViewModeToggle がセグメントを選んだ理由 (いま何が
  // 選ばれているか常に見える) は、現在値をラベルに出すことで保たれる
  // (docs/31 §3-4)
  const viewLabel: Record<ViewMode, string> = {
    compact: "小",
    card: "大",
    image: "画像",
  };
  const viewIcon: Record<ViewMode, ReactNode> = {
    compact: <ListViewIcon />,
    card: <GridViewIcon />,
    image: <ImageViewIcon />,
  };
  const nextViewOf: Record<ViewMode, ViewMode> = {
    compact: "card",
    card: "image",
    image: "compact",
  };
  const nextView = nextViewOf[view];
  // 長押しメニューに並べる順。循環と同じ並びにして、短いタップで辿る順と
  // メニューの上下が食い違わないようにする
  const viewOrder: ViewMode[] = ["compact", "card", "image"];
  // 並び順は 3 値の循環 (docs/37-アクセス順計画.md)。表示モードと同じ形にし、
  // ラベルには現在値を出す方針を保つ。順は「更新順 → アクセス順 → 番号順」で、
  // よく使う 2 つ (更新順・アクセス順) を隣どうしに置く
  const sortLabel: Record<Sort, string> = {
    updated: "更新順",
    accessed: "アクセス順",
    itemNo: "番号順",
  };
  const nextSortOf: Record<Sort, Sort> = {
    updated: "accessed",
    accessed: "itemNo",
    itemNo: "updated",
  };
  const nextSort = nextSortOf[sort];
  const sortOrder: Sort[] = ["updated", "accessed", "itemNo"];

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
          {/* 戻る/進む (← →)。もとはヘッダーにあったが下部バーの左端へ移した
              (HistoryNav.tsx の冒頭)。5 スロットのような flex-1 では伸ばさず、
              矢印ぶんの幅だけ占める */}
          <HistoryNav />

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

          {/* 表示モード。cookie を書くフォーム送信なのでクライアント JS は
              要らない (JS 無効でも切り替わる)。value は**循環の次のモード**。
              長押し (右クリック) では循環を飛ばして直接選べる
              (docs/62-下部バー長押し計画.md)。メニューの行も同じフォームの
              submit ボタンなので、送り先も cookie の書き方も 1 通りのまま。
              relative … メニュー (absolute) の基準になる */}
          <form action={viewAction} className="relative flex flex-1">
            <button
              ref={viewButtonRef}
              type="submit"
              name={VIEW_MODE_COOKIE}
              value={nextView}
              aria-label={`表示: ${viewLabel[view]} (押すと${viewLabel[nextView]}に切替、長押しで一覧)`}
              aria-haspopup="menu"
              aria-expanded={openMenu === "view"}
              {...viewPress}
              onClick={(event) => dismissOrCycle(event, "view", viewPress.onClick)}
              className={`${BOTTOM_BAR_SLOT_CLASS} text-gray-700`}
            >
              <SlotIcon color="text-emerald-600">{viewIcon[view]}</SlotIcon>
              {viewLabel[view]}
            </button>
            {/* メニューは**ボタンより後ろ**に置く。absolute なので見た目の
                位置は変わらないが、DOM の並びがそのままタブ順になるため、
                前に置くと開いた項目へ Shift+Tab でしか入れない */}
            {openMenu === "view" && (
              <SlotMenu
                label="表示"
                anchorRef={viewButtonRef}
                onClose={closeMenu}
              >
                {viewOrder.map((mode) => (
                  <button
                    key={mode}
                    type="submit"
                    name={VIEW_MODE_COOKIE}
                    value={mode}
                    role="menuitemradio"
                    aria-checked={mode === view}
                    onClick={closeAfterSubmit}
                    className={SLOT_MENU_ITEM_CLASS}
                  >
                    <MenuCheck checked={mode === view} />
                    <SlotIcon color="text-emerald-600">
                      {viewIcon[mode]}
                    </SlotIcon>
                    {viewLabel[mode]}
                  </button>
                ))}
              </SlotMenu>
            )}
          </form>

          {/* 並び順。表示モードと同じくフォーム送信にする (JS 無効でも動く)。
              **リンクではなくフォームなのは cookie に覚えるため** — リンクだと
              URL しか変わらず、?sort= を持たない入口 (ヘッダーのホーム・検索
              フォーム・スキャン・タグリンク) から入るたびに既定へ戻っていた
              (src/lib/sortMode.ts)。アクション側が cookie を書いてから
              ?sort= 付きの URL へ redirect するので、URL が正なのは変わらない。
              検索語は hidden で持ち回す (並び替えで検索語が消えては困る) */}
          <form action={sortAction} className="relative flex flex-1">
            <input type="hidden" name="q" value={query} />
            <button
              ref={sortButtonRef}
              type="submit"
              name={SORT_COOKIE}
              value={nextSort}
              aria-label={`並び順: ${sortLabel[sort]} (押すと${sortLabel[nextSort]}に切替、長押しで一覧)`}
              aria-haspopup="menu"
              aria-expanded={openMenu === "sort"}
              {...sortPress}
              onClick={(event) => dismissOrCycle(event, "sort", sortPress.onClick)}
              className={`${BOTTOM_BAR_SLOT_CLASS} text-gray-700`}
            >
              <SlotIcon color="text-amber-600">
                <SortIcon />
              </SlotIcon>
              {sortLabel[sort]}
            </button>
            {/* 表示モードと同じく、メニューはボタンより後ろ (タブ順のため) */}
            {openMenu === "sort" && (
              <SlotMenu
                label="並び順"
                anchorRef={sortButtonRef}
                onClose={closeMenu}
              >
                {sortOrder.map((value) => (
                  <button
                    key={value}
                    type="submit"
                    name={SORT_COOKIE}
                    value={value}
                    role="menuitemradio"
                    aria-checked={value === sort}
                    onClick={closeAfterSubmit}
                    className={SLOT_MENU_ITEM_CLASS}
                  >
                    <MenuCheck checked={value === sort} />
                    <SlotIcon color="text-amber-600">
                      <SortIcon />
                    </SlotIcon>
                    {sortLabel[value]}
                  </button>
                ))}
              </SlotMenu>
            )}
          </form>

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
