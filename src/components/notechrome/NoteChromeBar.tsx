"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useNoteChrome } from "@/components/notechrome/NoteChromeProvider";

// ホバーで開くまでの待ち。上端をかすめただけの通過で面がちらつかないように
export const HOVER_OPEN_DELAY_MS = 150;
// 離れてから閉じるまでの待ち。行から面へ移る途中や、面の縁を少し
// はみ出しただけで閉じないように
export const HOVER_CLOSE_DELAY_MS = 250;

interface NoteChromeBarProps {
  // 貼り付く位置と地色 (器ごとに違う)。sticky と z はここで持つ
  className: string;
  // 行の中身の幅と余白 (器ごとに違う)
  rowClassName: string;
  // 左端 (閉じる)。置かないときも詰め物を置いて右端を右に保つ
  start?: ReactNode;
  // 右端 (全画面で開く)
  end?: ReactNode;
}

// ノートの器の上端に貼り付く行 (docs/108-ノート全画面表示計画.md §3-1)。
//
// 閉じる・全画面で開くの間に呼び口の差し込み口を、行の直下に重ねる面の
// 差し込み口を持つ。重ねる面は absolute top-full で行の下に被さるので、
// 本文を押し下げず、どこまでスクロールしていても上端から出る。
//
// **ホバーとフォーカスは素の DOM で見る** (§3-3)。React の onPointerLeave は
// React の木で判定するため、portal で差し込んだ面へマウスを動かしただけで
// 「行を離れた」になる。面は DOM の上では行の子なので、素のイベントなら
// 行の外へ出るまで閉じない。
//
// 器 (NoteChromeProvider) の外では差し込み口が空のまま、ただの行として描く
export function NoteChromeBar({
  className,
  rowClassName,
  start,
  end,
}: NoteChromeBarProps) {
  const chrome = useNoteChrome();
  const rootRef = useRef<HTMLDivElement>(null);

  const scheduleHover = chrome?.scheduleHover;
  const setFocused = chrome?.setFocused;
  const dismiss = chrome?.dismiss;
  const revealed = chrome?.revealed ?? false;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !scheduleHover || !setFocused) {
      return;
    }
    // 指のタップでも pointerenter は飛んでくる。指の端末は ⋯ が受ける
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        scheduleHover(true, HOVER_OPEN_DELAY_MS);
      }
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        scheduleHover(false, HOVER_CLOSE_DELAY_MS);
      }
    };
    // タップやクリックのフォーカスは focus-visible にならない。Tab で
    // 入ったときだけ開く (docs/107 §2 と同じ判断)
    const onFocusIn = (event: FocusEvent) => {
      if (
        event.target instanceof Element &&
        event.target.matches(":focus-visible")
      ) {
        setFocused(true);
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !root.contains(next)) {
        setFocused(false);
      }
    };
    root.addEventListener("pointerenter", onEnter);
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, [scheduleHover, setFocused]);

  // 開いている間だけ、行の外を押したら・Esc を押したら閉じる。押下を capture で
  // 拾うのは、押された側 (本文のリンクなど) が伝播を止めても取りこぼさないため
  useEffect(() => {
    const root = rootRef.current;
    if (!revealed || !root || !dismiss) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) {
        dismiss();
      }
    };
    // Esc は行の中ではなく document で拾う。面の中のトグル (公開など) は
    // 押すと釦ごと差し替わり、フォーカスが body へ落ちる — 行の keydown では
    // 届かなくなる (E2E で判明)。開いている間だけなので、ほかの画面の Esc
    // (モーダル類) とは競らない。先に誰かが処理した Esc には乗らない
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        dismiss();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [revealed, dismiss]);

  return (
    <div
      ref={rootRef}
      data-note-chrome-bar=""
      className={`print:hidden ${className}`}
    >
      <div
        className={`flex items-center justify-between gap-1 ${rowClassName}`}
      >
        {start ?? <span />}
        <div className="flex items-center gap-1">
          <div
            ref={chrome?.setTriggerSlot}
            className="flex items-center gap-1 empty:hidden"
          />
          {end}
        </div>
      </div>
      <div ref={chrome?.setOverlaySlot} />
    </div>
  );
}
