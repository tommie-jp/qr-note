"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClearIcon } from "@/components/icons";
import { noteCache } from "@/lib/client/noteStore";
import { placeAround, type Placement } from "../event/placePopover";
import EventForm from "./EventForm";

// 開く予定。isNew は「+」で振った新しい番号 (まだサーバに無いので取りに行かない)
export interface EditingEvent {
  itemId: string;
  isNew: boolean;
  // 押した行 (「+」) の要素。そのすぐ上か下にフォームを出す
  anchor: HTMLElement;
}

// 下のペインの予定の行を押したとき、行のそばに予定のフォームを浮かせて出す
// (docs/126 §1-6)。中身はノートの「予定」タブと同じ EventForm で、保存・
// ゴミ箱へ移したら閉じる。
//
// 送り (scroll) では閉じずに置き直す — iPhone はキーボードが出ると画面を
// 送るので、閉じるとフォームが打つ前に消える。body へ portal する理由は
// DayPopover と同じ
export function EventPopover({
  editing,
  day,
  query,
  onClose,
}: {
  editing: EditingEvent;
  day: string;
  query: string;
  onClose: () => void;
}) {
  const { itemId, isNew, anchor } = editing;
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const entry = noteCache.useEntry(isNew ? null : itemId);
  const ready = isNew || entry?.value !== undefined;

  const place = useCallback(() => {
    const box = ref.current;
    if (box === null) {
      return;
    }
    box.style.maxHeight = "";
    setPlacement(
      placeAround(
        anchor.getBoundingClientRect(),
        { width: box.offsetWidth, height: box.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor]);

  useLayoutEffect(place, [place, ready]);

  // 中身の高さが変わる (終日を外すと時刻の欄が出る・エラーの行) たびに置き直す
  useEffect(() => {
    const box = ref.current;
    if (box === null) {
      return;
    }
    const observer = new ResizeObserver(() => place());
    observer.observe(box.firstElementChild ?? box);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);

  // 外を押す・Esc で閉じる。別の行を押したときは、閉じた後でその行が開き直す。
  // 開いた行そのものは閉じない (押し直すと閉じて開き直し、ちらつく)
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
        anchor.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={isNew ? "予定を追加" : "予定を直す"}
      data-event-popover=""
      style={
        placement === null
          ? { left: 0, top: 0, visibility: "hidden" }
          : { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
      }
      className="fixed z-40 w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded bg-white shadow-xl"
    >
      <div className="relative">
        <button
          type="button"
          aria-label="閉じる"
          title="閉じる"
          onClick={onClose}
          className="absolute top-1 right-1 z-10 flex size-8 items-center justify-center rounded text-gray-500 hover:bg-gray-100 [&>svg]:size-5"
        >
          <ClearIcon />
        </button>
        {!ready ? (
          <p className="rounded border border-gray-300 p-3 text-sm text-gray-500">
            {entry?.error ? `読み込めませんでした: ${entry.error.message}` : "読み込み中…"}
          </p>
        ) : (
          <EventForm
            itemId={itemId}
            item={isNew ? null : (entry?.value?.item ?? null)}
            initialDate={day}
            query={query}
            fullscreen={false}
            onDone={onClose}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
