"use client";

import { useEffect } from "react";

// 開いている間は後ろのページをスクロールさせない (docs/93-リファクタリング計画.md §3-2)。
//
// 暗くした背景が指で動くと「触れないのに動く」矛盾になるうえ、覆いの中を
// 弾いたつもりが後ろが流れる (iOS のスクロール伝播)。
// 外すときは「hidden を消す」のではなく**掛ける前の値へ戻す**。
// 呼び出し側が先に overflow を持っていても壊さない

// overflow を読み書きできる相手。本番は document.body、テストは偽物を渡す
export interface ScrollLockTarget {
  style: { overflow: string };
}

// overflow:hidden を掛け、掛ける前の値へ戻す関数を返す
export function lockScroll(body: ScrollLockTarget): () => void {
  const previous = body.style.overflow;
  body.style.overflow = "hidden";
  return () => {
    body.style.overflow = previous;
  };
}

// active の間だけ document.body のスクロールを止める
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    return lockScroll(document.body);
  }, [active]);
}
