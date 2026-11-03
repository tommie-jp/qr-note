"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addMonths, eventsByDay, isMonth, jstToday, monthCells } from "../event/monthLayout";
import { calendarCache } from "./calendarStore";
import { CAL_PARAM, withCalendarMonth } from "./calendarUrl";
import { DayPopover } from "./DayPopover";
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
  // 開いている日 (予定をマスの横に浮かせて出す)。押したマスの要素で位置を測る
  const [opened, setOpened] = useState<{ day: string; cell: HTMLElement } | null>(null);
  const days = useMemo(() => monthCells(month), [month]);
  // 月送りの釦は閉じてから送る。URL の書き換え (戻る・検索語) で月が替わったときも
  // 開いていた日がマス目に無ければ出さない
  const shown = opened !== null && days.includes(opened.day) ? opened : null;
  const close = useCallback(() => setOpened(null), []);
  const select = useCallback((day: string, cell: HTMLElement) => setOpened({ day, cell }), []);

  const key = useMemo(() => ({ query, month }), [query, month]);
  const entry = calendarCache.useEntry(key);
  const payload = entry?.value;
  const byDay = useMemo(() => eventsByDay(payload?.events ?? [], days), [payload, days]);
  const [year, monthNumber] = month.split("-").map(Number);

  return (
    <div className="space-y-2" data-calendar="">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={NAV_BUTTON} aria-label="前の月" onClick={() => {
            setOpened(null);
            replaceMonth(addMonths(month, -1));
          }}>
          ◀
        </button>
        <h2 className="min-w-28 text-center font-medium" aria-live="polite">
          {year}年{monthNumber}月
        </h2>
        <button type="button" className={NAV_BUTTON} aria-label="次の月" onClick={() => {
            setOpened(null);
            replaceMonth(addMonths(month, 1));
          }}>
          ▶
        </button>
        <button
          type="button"
          className={NAV_BUTTON}
          onClick={() => {
            setOpened(null);
            replaceMonth(today.slice(0, 7));
          }}
        >
          今日
        </button>
        <span className="flex-1" />
        {/* 読み込み中の文字はここに出さない。見出し行が折り返してマス目がずれ、
            浮かせた一覧 (マスの位置で置いた) と食い違う。待ちはマス目を薄くして見せる */}
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
        <MonthGrid
          month={month}
          days={days}
          byDay={byDay}
          today={today}
          selected={shown?.day ?? null}
          onSelect={select}
        />
      </div>
      {shown !== null && (
        <DayPopover
          key={shown.day}
          day={shown.day}
          anchor={shown.cell}
          events={byDay.get(shown.day) ?? []}
          loading={payload === undefined}
          query={query}
          month={month}
          onClose={close}
        />
      )}
    </div>
  );
}
