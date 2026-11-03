"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addMonths, eventsByDay, isMonth, jstToday, monthCells } from "../event/monthLayout";
import { calendarCache } from "./calendarStore";
import { CAL_PARAM, withCalendarMonth } from "./calendarUrl";
import { DayStrip } from "./DayStrip";
import { MonthGrid } from "./MonthGrid";

// URL の cal を書き換える。履歴を増やさない (月送りは「戻る」で辿る物ではない)。
// Next は外からの replaceState に useSearchParams を追随させる (docs/123 §4-2)
function replaceMonth(month: string | null): void {
  window.history.replaceState(null, "", withCalendarMonth(new URL(location.href), month));
}

function pushList(): void {
  window.history.pushState(null, "", withCalendarMonth(new URL(location.href), null));
}

const NAV_BUTTON = "min-h-9 min-w-9 rounded px-2 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200";

// 検索結果のカレンダー表示 (docs/126 §1-3)。検索式に当たる予定を月のマス目に並べる。
// 検索窓・ペインの器は一覧と共有し、ここが持つのは結果の中身だけ
export default function CalendarView({ query }: { query: string }) {
  const params = useSearchParams();
  const [today] = useState(() => jstToday());
  const raw = params.get(CAL_PARAM) ?? "";
  const month = isMonth(raw) ? raw : today.slice(0, 7);
  const [picked, setPicked] = useState<string | null>(null);
  // 選んだ日がこの月のマス目に無ければ、今日 (今月なら) か 1 日を選ぶ
  const days = useMemo(() => monthCells(month), [month]);
  const selected =
    picked !== null && days.includes(picked) ? picked : today.startsWith(month) ? today : `${month}-01`;

  const key = useMemo(() => ({ query, month }), [query, month]);
  const entry = calendarCache.useEntry(key);
  const payload = entry?.value;
  const byDay = useMemo(() => eventsByDay(payload?.events ?? [], days), [payload, days]);
  const [year, monthNumber] = month.split("-").map(Number);

  return (
    <div className="space-y-2" data-calendar="">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={NAV_BUTTON} aria-label="前の月" onClick={() => replaceMonth(addMonths(month, -1))}>
          ◀
        </button>
        <h2 className="min-w-28 text-center font-medium" aria-live="polite">
          {year}年{monthNumber}月
        </h2>
        <button type="button" className={NAV_BUTTON} aria-label="次の月" onClick={() => replaceMonth(addMonths(month, 1))}>
          ▶
        </button>
        <button
          type="button"
          className={NAV_BUTTON}
          onClick={() => {
            setPicked(today);
            replaceMonth(today.slice(0, 7));
          }}
        >
          今日
        </button>
        <span className="flex-1" />
        {entry?.loading && <span className="text-xs text-gray-500">読み込み中…</span>}
        <button type="button" className={`${NAV_BUTTON} border border-gray-300`} onClick={pushList}>
          一覧
        </button>
      </div>

      {entry?.error && payload === undefined ? (
        <p role="alert" className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
          予定を読み込めませんでした: {entry.error.message}{" "}
          <button type="button" className="underline" onClick={() => calendarCache.load(key, { force: true })}>
            もう一度
          </button>
        </p>
      ) : null}
      {payload !== undefined && payload.omitted > 0 ? (
        <p role="status" className="rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          予定が多すぎるため {payload.omitted} 件を表示していません。検索式で絞ってください。
        </p>
      ) : null}

      <div className={payload === undefined ? "opacity-50" : undefined} aria-busy={payload === undefined}>
        <MonthGrid month={month} days={days} byDay={byDay} today={today} selected={selected} onSelect={setPicked} />
      </div>
      <DayStrip day={selected} events={byDay.get(selected) ?? []} query={query} month={month} />
    </div>
  );
}
