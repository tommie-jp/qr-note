"use client";

import type { ReactNode } from "react";
import { eventTimeLabel, type DayEvent } from "../event/monthLayout";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function dayLabel(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日 (${WEEKDAYS[weekday]})`;
}

// 行は 24px (min-h-6、文字 1 行ぶん) に詰める。1 日に何件あっても一覧として見渡せるように
export const DAY_ROW_CLASS = "flex min-h-6 w-full items-center gap-2 px-1 text-left text-sm leading-6 hover:bg-gray-50";

export function DayRowContent({ event }: { event: DayEvent }) {
  return (
    <>
      <span className="w-10 shrink-0 text-xs text-gray-500">{eventTimeLabel(event) ?? "終日"}</span>
      <span className="min-w-0 flex-1 truncate">{event.title || "(無題)"}</span>
    </>
  );
}

// 選んだ日の見出し・「+」・予定の行 (docs/126 §1-6)。浮かせた一覧 (1 ペイン) と
// 下のペイン (2・3 ペイン) が共有する。行を押したときの動きは器が決める (renderRow)
export function DayEventList({
  day,
  events,
  loading,
  onAdd,
  renderRow,
  trailing,
}: {
  day: string;
  events: readonly DayEvent[];
  // 月の予定がまだ届いていない (「予定はありません」と言わない)
  loading: boolean;
  // 押した「+」の要素を渡す (そのそばにフォームを出すため)
  onAdd: (button: HTMLElement) => void;
  renderRow: (event: DayEvent) => ReactNode;
  // 見出し行の右端に足す物 (ペインの「閉じる」)
  trailing?: ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">{dayLabel(day)}</h3>
        <button
          type="button"
          onClick={(e) => onAdd(e.currentTarget)}
          aria-label="予定を追加"
          title="予定を追加"
          className="flex size-7 items-center justify-center rounded bg-blue-600 text-base leading-none font-medium text-white active:bg-blue-700"
        >
          ＋
        </button>
        {trailing}
      </div>
      {events.length === 0 ? (
        <p className="py-0.5 text-sm text-gray-500">{loading ? "読み込み中…" : "予定はありません"}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {events.map((event) => (
            <li key={event.itemId}>{renderRow(event)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
