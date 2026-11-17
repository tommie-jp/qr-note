"use client";

import { useEffect, type RefObject } from "react";

// 浮かせたパネル (設定・1 ペインの日の一覧) を、外を押す・Esc で閉じる。
// CalendarMenu と DayPopover で同じ形だったのをまとめた (docs/128 §3-3)。
//
// 開いた要素 (anchor) を押したときは閉じない — 開け閉めは開いた側が受ける。
// keepSelector … ほかに押しても閉じない所 (日の一覧ならマス。マス目の側が別の日に替える)
export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  anchor: HTMLElement,
  onClose: () => void,
  keepSelector?: string,
): void {
  useEffect(() => {
    const keeps = (target: Node) =>
      anchor.contains(target) ||
      (keepSelector !== undefined && target instanceof Element && target.closest(keepSelector) !== null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !ref.current?.contains(target) && !keeps(target)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        anchor.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, anchor, onClose, keepSelector]);
}

// 下のペインの中に浮かせる物 (予定のフォーム・時刻のパネル) を、外を押す・Esc で閉じる。
// Esc は捕捉段で受けて止める (ペインの「閉じる」まで届かせない)。
// 開いた要素 (anchor) を押したときは閉じない (押し直すと閉じて開き直し、ちらつく)。
// refocus … 閉じたら開いた要素へ焦点を戻すか
export function useDismissInPane(
  ref: RefObject<HTMLElement | null>,
  anchor: HTMLElement,
  onClose: () => void,
  refocus: boolean,
): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !ref.current?.contains(target) && !anchor.contains(target)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        if (refocus) {
          anchor.focus();
        }
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [ref, anchor, onClose, refocus]);
}
