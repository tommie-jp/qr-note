"use client";

import { useEffect } from "react";

// Escape で閉じる (docs/93-リファクタリング計画.md §3-2)。
//
// 以前はモーダル・オーバーレイごとに同じ keydown の effect を手書きしていた。
// 拾うのは window の keydown で、焦点がどこにあっても効く。
// 「文字の入力中は閉じない」のような部品ごとの条件は、渡す onEscape の中で見る
// (DrawModal)。

// keydown を張り外しできる相手。本番は window、テストは偽物を渡す
export interface KeydownTarget {
  addEventListener(
    type: "keydown",
    listener: (event: Pick<KeyboardEvent, "key">) => void,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: Pick<KeyboardEvent, "key">) => void,
  ): void;
}

// Escape を押したら onEscape を呼ぶリスナーを張り、外す関数を返す
export function subscribeEscape(
  target: KeydownTarget,
  onEscape: () => void,
): () => void {
  const onKeyDown = (event: Pick<KeyboardEvent, "key">) => {
    if (event.key === "Escape") {
      onEscape();
    }
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}

// active の間だけ Escape を拾う。onEscape が変わると張り直すので、
// 描画ごとに作り直す関数を渡すなら useCallback で包む
export function useEscapeKey(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    return subscribeEscape(window, onEscape);
  }, [onEscape, active]);
}
