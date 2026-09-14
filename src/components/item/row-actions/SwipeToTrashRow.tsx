"use client";

import { useState, type ReactNode } from "react";
import type { MenuPoint } from "@/lib/gesture/rowActionMenu";
import { SWIPE_BUTTON_WIDTH } from "@/lib/gesture/swipeRow";
import { useRowGestureArbiter } from "./useRowGestureArbiter";
import {
  useRowTrash,
  type RowSearchState,
  type RowTrashAction,
} from "./useRowTrash";
import { useSwipeDrawer } from "./useSwipeDrawer";
import { TrashIcon } from "../../icons";
import { RowActionMenu } from "./RowActionMenu";
import { RowActionButtons, type RowAction } from "./RowActions";

// 1 行ぶんのスワイプ削除に要る物 (docs/43-スワイプ削除計画.md)。
//
// **4 つを 1 つの袋で渡す。** 以前は ItemRow の props に散っていて、
// 1 つでも渡し忘れるとスワイプごと黙って無効になっていた。特に searchState は
// 無いと trashItemsAction の redirect 先が素の / になり、「検索して 1 件消したら
// 全件の先頭に居た」になる — 袋ごと必須にすれば型が渡し忘れを捕まえる。
// 選択モード (checkbox あり) やゴミ箱の一覧では袋ごと渡さない
export interface RowSwipe {
  // ノートをゴミ箱へ入れるサーバーアクション (BulkTagToolbar と同じ trashItemsAction)。
  trashAction: RowTrashAction;
  // 削除後に戻る検索状態
  searchState: RowSearchState;
  // この行が開いているか。「開くのは常に 1 行だけ」を親 (ItemList) が持つ。
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SwipeToTrashRowProps {
  itemNo: string;
  swipe: RowSwipe;
  // 小 … 削除で高さ 0 へ潰す。大 … 高さが可変・グリッドで隣に揃うので
  // 潰さずフェードで消す (docs/43 §9-1)。
  view: "compact" | "card";
  // カードの枠 (h-full rounded border bg-white) は ItemRow が持ち、li に足す
  // クラスとして渡す。見た目の定義を 2 か所に散らさない (docs/43 §9-2)。
  liClassName?: string;
  // 中身は ItemRow が組み立てた 1 行 / 1 カードぶん。
  children: ReactNode;
}

// ノートの 1 行 / 1 カードに操作を付けるラッパー。
//
//   左スワイプ … 右端の赤い「削除」ボタンを露出させる (docs/43-スワイプ削除計画.md)。
//   ホバー     … 右端にアイコンボタン列を出す。PC 用 (docs/66-行アクション計画.md §4)。
//   長押し     … 指の近くに操作メニューを出す。スマホ用 (docs/66 §5)。
//
// 引き出しの動きは useSwipeDrawer、押下の振り分けは useRowGestureArbiter、
// ゴミ箱行きの送信は useRowTrash が持つ。ここは DOM を並べて繋ぐだけ。
//
//   背面 … 右端に固定した赤い「削除」ボタン。
//   前面 … 既存の行 (bg-white)。translateX で左へずれてボタンを露出させる。
//
// **行アクションの一覧 (actions) をここで組む。** 送信中・失敗の状態を持てるのが
// この階層だけなので、実行する手と一覧を同じ所に置く。今後ピン留めなどを足す
// ときは actions に 1 つ足せば、ホバーの列とメニューの両方に同時に現れる。
export function SwipeToTrashRow({
  itemNo,
  swipe,
  view,
  liClassName = "",
  children,
}: SwipeToTrashRowProps) {
  const { trashAction, searchState, isOpen, onOpenChange } = swipe;
  const drawer = useSwipeDrawer(isOpen, onOpenChange);
  const { busy, removing, failed, isPending, trash } = useRowTrash(
    itemNo,
    trashAction,
    searchState,
  );
  // 長押しメニューを開いている位置 (画面座標)。閉じているときは null。
  //
  // **開いているメニューを 1 つに保つのに、親へ持ち上げる必要はない。**
  // RowActionMenu は document の pointerdown を capture で拾って閉じるので、
  // 別の行を押した時点で先に閉じる (スワイプの開閉が openItemNo を親に
  // 置いているのは、あちらが「押されていない間も開いたまま」だから)
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);
  const gestures = useRowGestureArbiter({
    busy,
    drawer,
    onLongPress: (point) => {
      // 開きかけの引き出しは畳む。引き出しとメニューが同時に出ていると、
      // どちらの削除を押したのか判らなくなる
      onOpenChange(false);
      setMenuAt(point);
    },
  });

  // 行アクションの一覧 (docs/66 §3)。ホバーのボタン列と長押しメニューは
  // どちらもこれを描くので、1 つ足せば両方に同時に現れる。
  // useMemo で包まない — 読む側 (ボタン列・メニュー) はどちらも毎描画で
  // 描き直す軽い部品で、同一性に依存する所が無い
  const actions: RowAction[] = [
    {
      key: "trash",
      label: "ゴミ箱へ移動",
      icon: <TrashIcon />,
      danger: true,
      onSelect: trash,
    },
  ];

  const open = drawer.isRevealed;
  const isCard = view === "card";

  // 削除実行後の消え方。小は高さ 0 へ潰し (一覧が詰まる)、大はフェードだけ
  // (高さ可変・グリッドで隣に揃うので潰しても空セルが残る。docs/43 §9-1)。
  const removingClass = isCard ? "opacity-0" : "max-h-0 opacity-0";
  // 潰さないときの高さ上限。小だけ max-h を効かせ、大はカードの高さに任せる。
  const restingClass = isCard ? "" : "max-h-24";

  return (
    <li
      // overflow-hidden … はみ出した削除ボタンと、畳むときの高さを切る。
      // liClassName … カードの枠 (h-full rounded border bg-white)。小では空。
      className={`relative overflow-hidden transition-all duration-200 ${liClassName} ${
        removing ? removingClass : restingClass
      }`}
    >
      {/* 背面: 右端に固定した削除ボタン。inset-y-0 で行 / カードの全高に伸びる */}
      <button
        type="button"
        onClick={trash}
        disabled={busy || !open}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        aria-label={`#${itemNo} を削除`}
        style={{ width: SWIPE_BUTTON_WIDTH }}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-600 text-sm font-medium text-white disabled:opacity-60"
      >
        {isPending ? "…" : "削除"}
      </button>

      {/* 前面: 既存の行。指に追従してずらす。カードは h-full で枠の高さに追従。
          押下の振り分け (onPointerLeave を繋がない理由も) は useRowGestureArbiter */}
      <div
        {...gestures}
        // pan-y … 縦スクロールはブラウザに任せ、横だけこちらが取る。
        // ドラッグ中だけ transition を外して指に張り付かせる。
        //
        // group … ホバーでアイコンボタン列を出すための的 (docs/66 §4)。
        // touch:select-none / -webkit-touch-callout:none … 長押しに反応させる
        // ための備え (§5-2)。iOS はリンクを長押しすると既定でプレビューの
        // 吹き出しを出し、こちらのメニューに重なる。**行の当たり判定は本物の
        // <a> なので、contextmenu を止めるだけでは防げない**。選択の禁止は
        // タッチだけに絞る — PC まで効かせると一覧の文字をマウスで選べなくなる
        className={`group relative bg-white touch-pan-y touch:select-none [-webkit-touch-callout:none] ${
          isCard ? "h-full" : ""
        } ${drawer.dragging ? "" : "transition-transform duration-200"}`}
        style={{ transform: `translateX(${drawer.offset}px)` }}
      >
        {children}
        {/* PC 用のボタン列。スマホでは hover が無いので出ない (§4) */}
        <RowActionButtons itemNo={itemNo} actions={actions} view={view} />
        {failed && (
          <p className="px-4 pb-1 text-sm text-red-600" role="alert">
            削除に失敗しました。通信を確認して再度お試しください。
          </p>
        )}
      </div>

      {/* 長押しメニュー (§5-3)。**前面 div の中に置いてはいけない** —
          あちらは translateX を持ち、transform のある要素は fixed の包含
          ブロックになるので、画面座標のつもりの位置が行の中を指す。
          ここに置けば body へ portal されるだけで、li の overflow-hidden にも
          切られない */}
      {menuAt && (
        <RowActionMenu
          label={`#${itemNo} の操作`}
          actions={actions}
          at={menuAt}
          onClose={() => setMenuAt(null)}
        />
      )}
    </li>
  );
}
