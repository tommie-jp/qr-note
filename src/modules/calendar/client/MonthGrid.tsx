"use client";

import { eventTimeLabel, type DayEvent } from "../event/monthLayout";

// 月のマス目 (docs/126 §1-3)。日曜始まりの 7 列。
//
// マスの中の予定は**押せる物にしない**。iPhone 幅ではマスが 50px ほどで、
// 中の文字をリンクにすると日を選ぶつもりの指が予定を開いてしまう。
// 日を押すとマスの横にその日の予定が浮かんで並び (DayPopover)、そこから開く
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
// 1 マスに出す予定の数。超えた分は「+N」。**マスの高さは予定の数で変えない**
// (週の行が伸び縮みすると月の見た目が揃わない)。高さ (h-20 / sm:h-25) は
// 日付 1 行 + 予定 N 行 + 「+N」1 行がちょうど入る値で、件数とは対
//   スマホ幅 … 80px に 2 件、PC 幅 (sm) … 100px に 3 件
// (余白 4 + 日付 20 + 行 16 × 件数+1 + 間 2 × 件数+1 + 枠 1)
const CHIPS_NARROW = 2;
const CHIPS_WIDE = 3;

function weekdayColor(index: number): string {
  return index === 0 ? "text-red-600" : index === 6 ? "text-blue-600" : "text-gray-600";
}

export function MonthGrid({
  month,
  days,
  byDay,
  today,
  selected,
  onSelect,
}: {
  month: string;
  days: readonly string[];
  byDay: ReadonlyMap<string, readonly DayEvent[]>;
  today: string;
  selected: string | null;
  // 押したマスの要素も渡す (浮かせる一覧の位置を測る)
  onSelect: (day: string, cell: HTMLElement) => void;
}) {
  return (
    <div className="select-none" data-calendar-grid="">
      <div className="grid grid-cols-7 text-center text-xs" aria-hidden="true">
        {WEEKDAYS.map((label, i) => (
          <div key={label} className={`py-1 ${weekdayColor(i)}`}>
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-t border-l border-gray-200" role="grid" aria-label={`${month} の予定`}>
        {days.map((day, i) => {
          const events = byDay.get(day) ?? [];
          const inMonth = day.startsWith(month);
          const isToday = day === today;
          const isSelected = day === selected;
          const dayNumber = Number(day.slice(8));
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-haspopup="dialog"
              aria-expanded={isSelected}
              aria-label={`${Number(day.slice(5, 7))}月${dayNumber}日 ${events.length} 件`}
              data-day={day}
              onClick={(event) => onSelect(day, event.currentTarget)}
              className={`flex h-20 min-w-0 flex-col items-stretch gap-0.5 overflow-hidden border-r border-b border-gray-200 p-0.5 text-left align-top transition-colors sm:h-25 ${
                inMonth ? "bg-white" : "bg-gray-50 text-gray-400"
              } ${isSelected ? "outline-2 -outline-offset-2 outline-blue-500" : ""} hover:bg-blue-50`}
            >
              <span
                className={`self-start rounded-full px-1 text-xs leading-5 ${
                  isToday ? "bg-blue-600 font-bold text-white" : inMonth ? weekdayColor(i % 7) : ""
                }`}
              >
                {dayNumber}
              </span>
              {events.slice(0, CHIPS_WIDE).map((event, index) => (
                <span
                  key={event.itemId}
                  // 済みは取り消し線で薄く (日の中では最後に並ぶ。eventsByDay)
                  className={`shrink-0 truncate rounded px-0.5 text-[0.625rem] leading-4 sm:text-xs ${
                    index >= CHIPS_NARROW ? "hidden sm:block" : ""
                  } ${
                    event.done
                      ? "text-gray-400 line-through"
                      : event.allDay
                        ? "bg-emerald-100 text-emerald-900"
                        : "text-gray-800"
                  }`}
                >
                  {eventTimeLabel(event) !== null && (
                    <span className="hidden text-gray-500 sm:inline">{eventTimeLabel(event)} </span>
                  )}
                  {event.title || "(無題)"}
                </span>
              ))}
              {events.length > CHIPS_NARROW && (
                <span className="shrink-0 px-0.5 text-[0.625rem] leading-4 text-gray-500 sm:hidden">
                  +{events.length - CHIPS_NARROW}
                </span>
              )}
              {events.length > CHIPS_WIDE && (
                <span className="hidden shrink-0 px-0.5 text-xs leading-4 text-gray-500 sm:block">
                  +{events.length - CHIPS_WIDE}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
