"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { refreshRouter } from "@/lib/client/navigation";
import { startTransition, useCallback, useState } from "react";
import { SelectIcon, SlideshowIcon, TrashIcon } from "@/components/icons";
import { perfMarkImmediate, perfNow, perfStart } from "@/lib/perf/perfClient";
import { switchViewMode } from "@/components/search/switchViewMode";
import { useImageViewer } from "@/components/imageviewer/ImageViewerProvider";
import { useSelectMode } from "@/components/search/SelectModeProvider";
import { SlotIcon } from "@/components/bottombar/SlotIcon";
import { SortSlot } from "@/components/bottombar/SortSlot";
import { INLINE_SLOT_CLASS, SLOT_LABEL_CLASS } from "@/components/ui";
import { ViewSlot } from "@/components/bottombar/ViewSlot";
import { SEARCH_SORT_SPEC } from "@/lib/prefs/sortDirection";
import { SORT_COOKIE } from "@/lib/prefs/sortMode";
import { parseViewMode, VIEW_MODE_COOKIE } from "@/lib/prefs/viewMode";
import type { Sort } from "@/lib/validation";
import type { ViewMode } from "@/lib/prefs/viewMode";
import { RESULT_VIEWS } from "@/modules/registry";

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
  // ゴミ箱の件数。0 ならゴミ箱へのリンクを出さない
  trashCount?: number;
}

// 検索結果の見出し行 (件数の右) に並べる操作 (docs/86 §4-11)。
//
// **帯は 1 行で、収まらない分は帯の中だけ横へ送る** (docs/86 §4-33)。
// 並びは ? / カレンダー / 表示 / 並び順 (種別・向き) / 選択 / ゴミ箱 / スライドショー。
// 出たり消えたりする物 (ゴミ箱は件数 0 で、スライドショーは画像表示だけ) を
// 末尾に寄せて、出入りで他の釦の位置が動かないようにしてある。
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
  trashCount = 0,
}: ResultsToolbarProps) {
  const { selectMode, enter, exit } = useSelectMode();
  // provider の外 (オフライン一覧など) では出さない
  const viewer = useImageViewer();
  const { openMenu, closeMenu, openView, openSort } = useSlotMenus();
  // view は親 (SearchResultsClient) が送った先を重ねた後の値。**ここで
  // useShownViewMode を重ねない** — 送った先を「サーバの値」として渡すことに
  // なり、保存の返事が来た瞬間に「サーバが追いついた」と誤判定して送った先を
  // 捨てていた。一覧が一瞬もとの表示に戻り (チラつき)、ノートを開いた 2 ペインでは
  // refresh を遅らせているので戻ったままになった (docs/123 §12-10)
  const shownView = view;

  const onViewSubmit = useViewModeSubmit(shownView);

  return (
    <ToolbarStrip>
      {helpLink()}
      {/* モジュールの表示 (カレンダーなど。docs/126 §1-3)。一覧から移るだけで、
          戻るのは表示の側の「一覧」。履歴に積むので「戻る」でも一覧へ戻れる */}
      {!selectMode && moduleViewButtons(query)}
      {/* contents … 拾うための器で、並びには参加しない */}
      <span className="contents" onSubmitCapture={onViewSubmit}>
      <ViewSlot
        view={shownView}
        action={viewAction}
        open={openMenu === "view"}
        onOpen={openView}
        onClose={closeMenu}
        variant="inline"
      />
      </span>
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
      {selectModeButton(selectMode, selectMode ? exit : enter)}
      {trashCount > 0 && trashLink(trashCount)}
      {/* 選択中は出さない (一覧のどこを押しても選択にする流儀。docs/116 §1) */}
      {slideshow && viewer !== null && !selectMode && slideshowButton(viewer.startSlideshow)}
    </ToolbarStrip>
  );
}

// 横送りの窓。書き方はヘッダーの帯 (AppHeader) と同じ:
// overscroll-x-contain … 端まで送った勢いがブラウザの「戻る」に化けない。
// [scrollbar-width:none] … 帯の下にバーを出す場所が無い。右端で釦が
//   切れていること自体が「まだある」の合図になる。
// grow + min-w-0 … 件数の残りを全部もらい、足りなければ窓ごと縮んで送る。
// 長押しメニューは body へ portal するので、この窓では切り取られない。
// 送ると釦とメニューがずれるが、SlotMenu がスクロールで閉じる
function ToolbarStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 grow overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
      {/* ml-auto … 収まるときは右寄せ (件数は左、操作は右)。溢れると 0 に
          なり、左端から送れる (justify-end だと左にはみ出した分へ届かない)。
          shrink-0 … 縮めずに溢れさせる。縮むと送る必要のない形に潰れる */}
      <span className="ml-auto flex shrink-0 items-center gap-1">{children}</span>
    </div>
  );
}

// 検索の書き方の説明へ
function helpLink() {
  return (
    <Link
      href="/docs/search"
      aria-label="検索ヘルプ"
      title="検索ヘルプ"
      className="rounded-full border border-blue-300 px-1.5 text-xs leading-4 text-blue-600"
    >
      ?
    </Link>
  );
}

// ゴミ箱の一覧へ
function trashLink(trashCount: number) {
  return (
    <Link
      href="/trash"
      transitionTypes={["nav-forward"]}
      aria-label={`ゴミ箱 (${trashCount} 件)`}
      title="ゴミ箱"
      className="inline-flex items-center gap-0.5 self-center px-1 text-xs text-blue-600"
    >
      <TrashIcon small />({trashCount})
    </Link>
  );
}

// 長押しで開いているメニュー。1 つの state で持つので二枚同時には開かない
// (下部バーと同じ作り)
function useSlotMenus() {
  const [openMenu, setOpenMenu] = useState<"view" | "sort" | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const openView = useCallback(() => setOpenMenu("view"), []);
  const openSort = useCallback(() => setOpenMenu("sort"), []);
  return { openMenu, closeMenu, openView, openSort };
}

// 表示モードの釦 (循環の釦かメニューの行) の submit を拾って、押した瞬間に切り替える
function useViewModeSubmit(shownView: ViewMode) {
  // 表示モードは押した瞬間に一覧を描き替える (docs/118 §10 案 B)。送った先を
  // store に置き (一覧と釦が同じ値を読む)、cookie の保存と足りない材料の補充は
  // switchViewMode が後ろで進める。本番では Server Action の往復 (150〜270ms)
  // を待ってから一覧が変わっていた (§0-11)
  const router = useRouter();

  // 釦 (循環の釦かメニューの行) の submit を外側で拾い、Server Action を止めて
  // 切り替える。**form の action は素の Server Action のまま残す** — JS が
  // 動かないときはネイティブの送信でそちらが受ける (CycleSlot の注)。
  // React は通常のイベントの後で defaultPrevented を見て、立っていれば
  // action を呼ばない。送った値は submit を起こした釦の value にある
  const onViewSubmit = useCallback(
    (event: React.FormEvent<HTMLSpanElement>) => {
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      if (!(submitter instanceof HTMLButtonElement) || submitter.name !== VIEW_MODE_COOKIE) {
        return;
      }
      event.preventDefault();
      const next = parseViewMode(submitter.value);
      perfStart("表示", "/", undefined, [["切替", `${shownView}→${next}`]]);
      void switchViewMode(next, () => {
        startTransition(() => refreshRouter(router));
      });
      // 押してから新しいモードが画面に出るまで (2 フレーム目 = 描き替えの後の描画)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => perfMarkImmediate("表示", perfNow())),
      );
    },
    [shownView, router],
  );
  return onViewSubmit;
}

// 一覧の先頭の画像から全画面で流す
function slideshowButton(startSlideshow: () => boolean) {
  return (
    <button
      type="button"
      onClick={() => startSlideshow()}
      aria-label="スライドショー"
      title="スライドショー"
      className={`${INLINE_SLOT_CLASS} text-gray-700`}
    >
      <SlotIcon color="text-indigo-600">
        <SlideshowIcon />
      </SlotIcon>
      <span className={SLOT_LABEL_CLASS}>スライドショー</span>
    </button>
  );
}

// モジュールの表示へ移る釦 (カレンダーなど)
function moduleViewButtons(query: string) {
  return RESULT_VIEWS.map((resultView) => (
    <button
      key={resultView.id}
      type="button"
      onClick={() => window.history.pushState(null, "", resultView.enterHref(query))}
      aria-label={resultView.label}
      title={resultView.label}
      className={`${INLINE_SLOT_CLASS} text-gray-700`}
    >
      <SlotIcon color="text-rose-600">{resultView.icon}</SlotIcon>
      <span className={SLOT_LABEL_CLASS}>{resultView.label}</span>
    </button>
  ));
}

// 一括タグ付け・ゴミ箱行きのための選択モードの切り替え。一覧側 (ItemList) と
// 状態を共有するので context 経由で切り替える
function selectModeButton(selectMode: boolean, onClick: () => void) {
  return (
    <button
      type="button"
      onClick={onClick}
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
  );
}
