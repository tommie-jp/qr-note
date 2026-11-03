"use client";

import Link from "next/link";
import { newItemId } from "@/lib/items/itemId";
import { navigate } from "@/lib/client/navigation";
import { eventTimeLabel, type DayEvent } from "../event/monthLayout";
import { eventNoteHref } from "./calendarUrl";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function dayLabel(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日 (${WEEKDAYS[weekday]})`;
}

// 選んだ日の予定と「+」(docs/126 §1-6)。足す前にその日の予定が見えるので、
// 同じ予定を二度足しにくい。
//
// 予定を押すとノートの「予定」タブが開く。検索画面の中では端末で開く印
// (data-client-note) を付けるので、2・3 ペインでは右のペイン、1 ペインでは
// 全画面になる (docs/123 §12)
export function DayStrip({
  day,
  events,
  query,
  month,
}: {
  day: string;
  events: readonly DayEvent[];
  query: string;
  month: string;
}) {
  // 番号は押したときに振る (描くたびに振ると、開いた後で番号が変わる)
  const addEvent = () => {
    navigate(eventNoteHref(newItemId(), query, month, day));
  };

  return (
    <section aria-label={`${dayLabel(day)} の予定`} className="space-y-1 rounded border border-gray-200 bg-white p-2">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">{dayLabel(day)}</h3>
        <button
          type="button"
          onClick={addEvent}
          className="min-h-9 rounded bg-blue-600 px-3 text-sm font-medium text-white active:bg-blue-700"
        >
          + 予定を追加
        </button>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-gray-500">予定はありません</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {events.map((event) => (
            <li key={event.itemId}>
              <Link
                href={eventNoteHref(event.itemId, query, month)}
                // 検索画面では端末で開く印 (docs/123 §12。lib/client/clientNoteNav.ts)
                data-client-note=""
                className="flex min-h-10 items-center gap-2 px-1 text-sm hover:bg-gray-50"
              >
                <span className="w-12 shrink-0 text-xs text-gray-500">{eventTimeLabel(event) ?? "終日"}</span>
                <span className="min-w-0 flex-1 truncate">{event.title || "(無題)"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
