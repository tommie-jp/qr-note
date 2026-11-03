"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { newItemId } from "@/lib/items/itemId";
import { navigate } from "@/lib/client/navigation";
import { eventTimeLabel, type DayEvent } from "../event/monthLayout";
import { placePopover, type Placement } from "../event/placePopover";
import { eventNoteHref } from "./calendarUrl";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function dayLabel(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日 (${WEEKDAYS[weekday]})`;
}

// 選んだ日の予定と「+」を、マスの横に浮かせて出す (docs/126 §1-6)。
// 右に出し、はみ出すなら左、縦は画面に収まるようずらす (placePopover)。
//
// **body へ portal する。** 検索結果の器は transform を持つことがあり、その中の
// fixed は器に縛られる。横スクロールの帯 (overflow) にも切り取られる
// (docs/86 §4-13 と同じ罠)。
//
// 予定を押すとノートの「予定」タブが開く (端末で開く印 data-client-note。
// 2・3 ペインは右のペイン、1 ペインは全画面)。押したら閉じる
export function DayPopover({
  day,
  anchor,
  events,
  loading,
  query,
  month,
  onClose,
}: {
  day: string;
  // 選んだマスの要素 (位置を測る)
  anchor: HTMLElement;
  events: readonly DayEvent[];
  // 月の予定がまだ届いていない (「予定はありません」と言わない)
  loading: boolean;
  query: string;
  month: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const place = useCallback(() => {
    const box = ref.current;
    if (box === null) {
      return;
    }
    // 測る前に縮めていた高さを外して、中身の本来の高さで測る
    box.style.maxHeight = "";
    setPlacement(
      placePopover(
        anchor.getBoundingClientRect(),
        { width: box.offsetWidth, height: box.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor]);

  // 描いた直後に測って置く (置く前の 1 フレームを見せない)。中身が変わったら置き直す
  useLayoutEffect(place, [place, events, loading]);

  // 画面の大きさが変わったら置き直す。マス目が送られたら (ペインの中の
  // スクロール) マスから離れて見えるので閉じる
  useEffect(() => {
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) {
        onClose();
      }
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [place, onClose]);

  // 外を押す・Esc で閉じる。マスを押したときは閉じない (マス目の側が別の日に替える)
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || ref.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest("[data-day]")) {
        return;
      }
      onClose();
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
  }, [anchor, onClose]);

  // 行は 24px (min-h-6、文字 1 行ぶん) に詰める。1 日に何件あっても一覧として見渡せるように。
  // 押す的としては小さめだが、押し間違えても開いたペインを閉じれば戻れる
  // 番号は押したときに振る (描くたびに振ると、開いた後で番号が変わる)
  const addEvent = () => {
    onClose();
    navigate(eventNoteHref(newItemId(), query, month, day));
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${dayLabel(day)} の予定`}
      data-day-popover=""
      style={
        placement === null
          ? { left: 0, top: 0, visibility: "hidden" }
          : { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
      }
      className="fixed z-40 w-64 max-w-[calc(100vw-1rem)] space-y-0.5 overflow-y-auto rounded border border-gray-300 bg-white p-2 shadow-lg"
    >
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">{dayLabel(day)}</h3>
        <button
          type="button"
          onClick={addEvent}
          aria-label="予定を追加"
          title="予定を追加"
          className="flex size-7 items-center justify-center rounded bg-blue-600 text-base leading-none font-medium text-white active:bg-blue-700"
        >
          ＋
        </button>
      </div>
      {events.length === 0 ? (
        <p className="py-0.5 text-sm text-gray-500">{loading ? "読み込み中…" : "予定はありません"}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {events.map((event) => (
            <li key={event.itemId}>
              <Link
                href={eventNoteHref(event.itemId, query, month)}
                // 検索画面では端末で開く印 (docs/123 §12。lib/client/clientNoteNav.ts)
                data-client-note=""
                onClick={onClose}
                className="flex min-h-6 items-center gap-2 px-1 text-sm leading-6 hover:bg-gray-50"
              >
                <span className="w-10 shrink-0 text-xs text-gray-500">{eventTimeLabel(event) ?? "終日"}</span>
                <span className="min-w-0 flex-1 truncate">{event.title || "(無題)"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}
