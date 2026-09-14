"use client";

import { useEffect, type RefObject } from "react";

// 結果をスクロールし始めたらキーボードを閉じる
// (docs/31-下部操作バー計画.md §8-3)。iOS 純正アプリ (メール・設定の検索) の
// keyboardDismissMode = .onDrag と同じ作法。検索窓 (SearchForm) から切り出した。
//
// 動機は 2 つ。1 つは iOS がキーボード表示中のスクロールで position:fixed を
// ビジュアルビューポートの下端へ貼り直すため、下部バーが一覧の途中にせり上がって
// 浮くこと。もう 1 つは、結果を読みに行く段になってもキーボードが画面の半分を
// 占め続けること。閉じれば両方が同時に片付く。
//
// **scroll ではなく touchmove で拾う。** キーボードが開くとき iOS は入力欄を
// 見せるために自前でスクロールするので、scroll だと開いた直後に自分で閉じてしまう。
// touchmove なら必ず指が動かした合図になる。
//
// 入力欄の中で始まった指の動き (文字列選択) では閉じない。フォームの中から
// 始まったかどうかを touchstart で覚えておいて判別する。

type TouchListener = (event: Pick<TouchEvent, "target">) => void;

// touchstart / touchmove を張り外しできる相手。本番は window、テストは偽物を渡す
export interface TouchTarget {
  addEventListener(
    type: "touchstart" | "touchmove",
    listener: TouchListener,
    options: { passive: true },
  ): void;
  removeEventListener(
    type: "touchstart" | "touchmove",
    listener: TouchListener,
  ): void;
}

// 指が動いたら dismiss を呼ぶリスナーを張り、外す関数を返す。
// isInside が true を返す所で始まった指の動きでは呼ばない
export function subscribeKeyboardDismiss(
  target: TouchTarget,
  isInside: (node: EventTarget | null) => boolean,
  dismiss: () => void,
): () => void {
  let startedInside = false;
  const onTouchStart: TouchListener = (e) => {
    startedInside = isInside(e.target);
  };
  const onTouchMove: TouchListener = () => {
    if (startedInside) {
      return;
    }
    dismiss();
  };
  target.addEventListener("touchstart", onTouchStart, { passive: true });
  target.addEventListener("touchmove", onTouchMove, { passive: true });
  return () => {
    target.removeEventListener("touchstart", onTouchStart);
    target.removeEventListener("touchmove", onTouchMove);
  };
}

// active (入力欄にフォーカスがある) の間だけ、container の外で始まった
// 指の動きで input を blur する
export function useKeyboardDismissOnScroll(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  inputRef: RefObject<HTMLInputElement | null>,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    return subscribeKeyboardDismiss(
      window,
      (node) =>
        node instanceof Node && (containerRef.current?.contains(node) ?? false),
      () => inputRef.current?.blur(),
    );
  }, [active, containerRef, inputRef]);
}
