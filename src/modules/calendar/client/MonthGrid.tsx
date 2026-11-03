"use client";

import { eventTimeLabel, type DayEvent } from "../event/monthLayout";

// 月のマス目 (docs/126 §1-3)。日曜始まりの 7 列。
//
// マスの中の予定は**押せる物にしない**。iPhone 幅ではマスが 50px ほどで、
// 中の文字をリンクにすると日を選ぶつもりの指が予定を開いてしまう。
// 日を押すとマスの横にその日の予定が浮かんで並び (DayPopover)、そこから開く
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
// 1 マスに出す予定の数。超えた分は「+N」
const CHIPS_PER_DAY = 3;

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
              className={`flex min-h-16 min-w-0 flex-col items-stretch gap-0.5 border-r border-b border-gray-200 p-0.5 text-left align-top transition-colors sm:min-h-24 ${
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
              {events.slice(0, CHIPS_PER_DAY).map((event) => (
                <span
                  key={event.itemId}
                  className={`truncate rounded px-0.5 text-[0.625rem] leading-4 sm:text-xs ${
                    event.allDay ? "bg-emerald-100 text-emerald-900" : "text-gray-800"
                  }`}
                >
                  {eventTimeLabel(event) !== null && (
                    <span className="hidden text-gray-500 sm:inline">{eventTimeLabel(event)} </span>
                  )}
                  {event.title || "(無題)"}
                </span>
              ))}
              {events.length > CHIPS_PER_DAY && (
                <span className="px-0.5 text-[0.625rem] leading-4 text-gray-500">
                  +{events.length - CHIPS_PER_DAY}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
