"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  SWIPE_BUTTON_WIDTH,
  beginSwipe,
  initialSwipeState,
  moveSwipe,
  resolveOpen,
  settleSwipe,
  type SwipeState,
} from "@/lib/gesture/swipeRow";

// 左スワイプで右端の「削除」を露出させる引き出し (docs/43-スワイプ削除計画.md)。
//
// 判定ロジックは lib/gesture/swipeRow.ts の純関数に任せ、ここは pointer の座標と
// DOM/React state の橋渡しに徹する。長押しやボタン列との取り合い
// (どの押下をこちらへ渡すか) は useRowGestureArbiter が決める。
//
// isOpen / onOpenChange … この行が開いているか。「開くのは常に 1 行だけ」を
// 親 (ItemList) が持つ
export function useSwipeDrawer(
  isOpen: boolean,
  onOpenChange: (open: boolean) => void,
) {
  // 動きの真実は ref に持つ (pointer ハンドラが前回値を同期に読めるように)。
  // ref は描画では触らず (react-hooks/refs)、offset / dragging を state へ写す。
  const stateRef = useRef<SwipeState>(initialSwipeState(isOpen));
  const [offset, setOffset] = useState(() =>
    isOpen ? -SWIPE_BUTTON_WIDTH : 0,
  );
  const [dragging, setDragging] = useState(false);
  // ドラッグ直後に飛んでくる click を 1 回だけ握りつぶす印
  // (stretched link がノートを開いてしまうのを防ぐ)。
  const suppressClick = useRef(false);

  const apply = (next: SwipeState) => {
    stateRef.current = next;
    setOffset(next.offset);
    setDragging(next.phase === "dragging");
  };

  // 親が別の行を開いた等でこの行の開閉指示が変わったら、指を離している間だけ
  // 追従する (ドラッグ中に横取りしない)。ref は effect の中で触る。
  useEffect(() => {
    if (stateRef.current.phase === "idle") {
      apply(settleSwipe(isOpen));
    }
  }, [isOpen]);

  // 押下の始まり。まだ何も動かさず、始点だけ記録して判定を待つ
  const begin = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 新しいジェスチャの開始で、前のドラッグが残した抑止フラグを捨てる。
    // 大きく払って開くと click が飛んでこず、抑止フラグが消費されないまま
    // 残る。それを次のタップ (閉じる操作) の click が食ってしまうため、
    // ここで必ずリセットする。同じジェスチャ内の click だけを抑止できる。
    suppressClick.current = false;
    apply(beginSwipe(stateRef.current, e.clientX, e.clientY, e.timeStamp));
  };

  // onDragStart … 横と確定した瞬間に 1 度だけ呼ぶ (長押しを捨てる合図に使う)
  const move = (
    e: ReactPointerEvent<HTMLDivElement>,
    onDragStart: () => void,
  ) => {
    const prev = stateRef.current;
    if (prev.phase === "idle") return;
    const next = moveSwipe(prev, e.clientX, e.clientY, e.timeStamp);
    // 横と確定した瞬間だけ pointer を捕まえ、枠の外へ出ても move を受け続ける。
    if (next.phase === "dragging" && prev.phase !== "dragging") {
      onDragStart();
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    apply(next);
  };

  // 指を離した (または押下が取り消された)。開くか閉じるかへスナップする
  const release = () => {
    const prev = stateRef.current;
    if (prev.phase !== "dragging") {
      // ドラッグに至らなかった (=タップ)。開閉は動かさない。click 側で処理する。
      if (prev.phase === "tracking") {
        apply(settleSwipe(isOpen));
      }
      return;
    }
    if (prev.dragged) {
      suppressClick.current = true;
    }
    const open = resolveOpen(prev);
    apply(settleSwipe(open));
    onOpenChange(open);
  };

  // 行への click を引き出しの都合で握り潰すか。握り潰したら true
  const swallowClick = (e: ReactMouseEvent<HTMLDivElement>): boolean => {
    // ドラッグ直後の click は 1 回だけ握りつぶす。
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    // 開いている間の行タップは「閉じる」だけ。ノートへは飛ばさない
    // (iOS 標準の作法。誤操作でノートが開くのを防ぐ)。
    if (stateRef.current.offset !== 0) {
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(false);
      return true;
    }
    return false;
  };

  return {
    offset,
    dragging,
    // 引き出しが見えているか (指の下で動いている途中も含む)
    isRevealed: offset !== 0,
    begin,
    move,
    release,
    swallowClick,
  };
}
