"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClearIcon } from "@/components/icons";
import { PANE_BOX_CLASS } from "@/components/panes/paneBox";
import { newItemId } from "@/lib/items/itemId";
import type { DayEvent } from "../event/monthLayout";
import { DAY_ROW_CLASS, DayEventList, DayRowContent, dayLabel } from "./DayEventList";
import { EventPopover, type EditingEvent } from "./EventPopover";

// 2・3 ペインで、選んだ日の予定をノートのペインの場所に出す (docs/126 §1-6)。
// 予定・「+」を押すと、その行のそばに予定のフォームを浮かせる (EventPopover)。
//
// 器は画像ビューアのペイン (ImageViewerPane) と同じ作り — ノートのペインと
// 同じ PANE_BOX_CLASS.pane を body へ portal し、下に隠れたノートのペインは
// inert にする。data-preview-pane で一覧 (マス目) が器の下に潜らない
export function DayPane({
  day,
  events,
  loading,
  query,
  onClose,
}: {
  day: string;
  events: readonly DayEvent[];
  loading: boolean;
  query: string;
  onClose: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<EditingEvent | null>(null);
  const closeEditing = useCallback(() => setEditing(null), []);

  useEffect(() => {
    const covered = [...document.querySelectorAll<HTMLElement>("[data-note-pane]")].filter(
      (el) => el !== sectionRef.current && !el.inert,
    );
    for (const el of covered) {
      el.inert = true;
    }
    return () => {
      for (const el of covered) {
        el.inert = false;
      }
    };
  }, []);

  // Esc で閉じる (フォームが出ている間はフォームが先に受けて止める)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // 番号は押したときに振る (描くたびに振ると、開いた後で番号が変わる)
  const add = (anchor: HTMLElement) => setEditing({ itemId: newItemId(), isNew: true, anchor });

  return createPortal(
    <section
      ref={sectionRef}
      data-day-pane=""
      data-preview-pane=""
      data-note-pane=""
      aria-label={`${dayLabel(day)} の予定`}
      className={`fixed inset-x-0 m-0 overflow-y-auto border-t border-gray-300 bg-white px-safe pt-2 pb-safe ${PANE_BOX_CLASS.pane}`}
    >
      <div className="px-3 pb-3">
        <DayEventList
          day={day}
          events={events}
          loading={loading}
          onAdd={add}
          renderRow={(event) => (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={editing?.itemId === event.itemId}
              onClick={(e) => setEditing({ itemId: event.itemId, isNew: false, anchor: e.currentTarget })}
              className={`${DAY_ROW_CLASS} ${editing?.itemId === event.itemId ? "bg-blue-50" : ""}`}
            >
              <DayRowContent event={event} />
            </button>
          )}
          trailing={
            <button
              type="button"
              aria-label="閉じる"
              title="閉じる"
              onClick={onClose}
              className="flex size-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100 [&>svg]:size-5"
            >
              <ClearIcon />
            </button>
          }
        />
      </div>
      {editing !== null && (
        <EventPopover
          key={editing.itemId}
          editing={editing}
          day={day}
          query={query}
          onClose={closeEditing}
        />
      )}
    </section>,
    document.body,
  );
}
