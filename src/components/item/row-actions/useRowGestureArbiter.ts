"use client";

import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { MenuPoint } from "@/lib/gesture/rowActionMenu";
import { ROW_ACTION_SELECTOR } from "@/components/item/row-actions/RowActions";
import { useLongPress } from "@/components/item/row-actions/useLongPress";
import type { useSwipeDrawer } from "./useSwipeDrawer";

// ボタン列の上で始まった押下は、スワイプにも長押しにも渡さない。
// ボタンを押しただけで行が滑ったり、押しているうちにメニューが
// ボタンを覆って出てくるのを防ぐ
function isOnRowAction(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ROW_ACTION_SELECTOR) !== null;
}

interface RowGestureOptions {
  // 削除の送信中か。送信中は新しい押下を受けない
  busy: boolean;
  drawer: ReturnType<typeof useSwipeDrawer>;
  // 長押しが成立した (指の近くにメニューを出す。docs/66 §5)
  onLongPress: (point: MenuPoint) => void;
}

// 行の前面 div に届く押下を、スワイプの引き出し・長押しメニュー・ボタン列・
// 行のリンク (stretched link) のどれに渡すかを決める (docs/66 §5-1)。
//
//   左スワイプ … 右端の赤い「削除」ボタンを露出させる (useSwipeDrawer)。
//   長押し     … 指の近くに操作メニューを出す。スマホ用。
//   ホバーの列 … PC 用のボタン列 (RowActionButtons)。押下は素通しする。
//
// 返すのは前面 div にそのまま展開するハンドラの組。
//
// **onPointerLeave は含めない。** タッチのポインタは pointerdown で
// 押した要素に暗黙に捕まるので、指が行の外へ出ても leave は来ず、
// 代わりに **pointerup の直後・互換 click の前**に後始末として飛んでくる。
// 繋ぐと長押し成立の印がそこで倒れ、続く click が握り潰されずに
// stretched link がノートを開く — 開いたばかりのメニューごと消える。
// 指が行から離れた場合の取り消しは onPointerMove の 10px 判定が既に見ている
export function useRowGestureArbiter({
  busy,
  drawer,
  onLongPress,
}: RowGestureOptions) {
  // 長押しでメニューを開く (docs/66 §5)。
  //
  // rightClick: "native" … PC の右クリックはブラウザ既定のメニューに渡す。
  // 行の当たり判定は本物のリンク (stretched link) で、「右クリックで URL を
  // コピー」は ItemRow が守ると明言している性質なので奪えない。PC には
  // ホバーのボタン列があり、長押しの代わりはそちらが務める
  const longPress = useLongPress(
    (point) => {
      if (busy) return;
      onLongPress(point);
    },
    { rightClick: "native" },
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (busy) return;
    // マウスは左ボタンのときだけ (右クリックのコンテキストメニューを邪魔しない)。
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (isOnRowAction(e.target)) return;
    // **マウスでは長押しを仕掛けない。** PC の近道はホバーのボタン列 (§4) で、
    // こちらは指のための入口。仕掛けると、ゆっくりクリックした人 (0.5 秒は
    // 意外と短い) の click が握り潰され、ノートが開かない行になる。
    // ペンは指と同じ扱い — ホバーを持たない入力なので長押しが要る
    if (e.pointerType !== "mouse") {
      longPress.handlers.onPointerDown(e);
    }
    drawer.begin(e);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    longPress.handlers.onPointerMove(e);
    // 横と確定した瞬間に**長押しを捨てる。** 取り消しの閾値はスワイプが 8px
    // (SWIPE_SLOP)、長押しが 10px (LONG_PRESS_MOVE_TOLERANCE_PX) で 2px
    // 重なっており、その隙間まで払って指を止めると、引き出しが開いたまま
    // 0.5 秒後にメニューまで出る
    drawer.move(e, longPress.cancel);
  };

  const onPointerUp = () => {
    longPress.handlers.onPointerUp();
    drawer.release();
  };

  const onPointerCancel = () => {
    longPress.handlers.onPointerCancel();
    onPointerUp();
  };

  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    // **ボタン列への click は何があっても素通しする。** 下の 2 つはどちらも
    // 「行のどこかを押した」ことを前提にした握り潰しで、ボタンに掛けると
    // 押しても何も起きないボタンになる — 引き出しが開いている間や、
    // ドラッグで開いた直後 (suppressClick が残っている) に実際そうなる。
    // capture 段で stopPropagation するとボタン自身の onClick まで届かない
    if (isOnRowAction(e.target)) {
      return;
    }
    // 長押しを終えた指離しの click は、長押し側が握り潰す (メニューを出した
    // だけのつもりでノートが開くのを防ぐ)。**スワイプの判定より先に見る** —
    // 後にすると「開いていないタップ」として素通りする
    if (longPress.handlers.onClick(e)) {
      return;
    }
    drawer.swallowClick(e);
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContextMenu: longPress.handlers.onContextMenu,
    onClickCapture,
  };
}
