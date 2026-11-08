"use client";

import { holidayName } from "../event/holidays";
import type { DayEvent } from "../event/monthLayout";
import { DATE_SIZE_CLASS } from "./dateSize";
import { useCalendarPrefs } from "./prefsStore";
import { eventColor } from "./priorityColor";

// 月のマス目 (docs/126 §1-3・§1-10)。月曜始まりの 7 列。見た目は iPhone の
// SaiSuke2 に寄せる (大きな日付、色の帯の予定、土日・祝日は薄いピンク、
// 今日は日付の帯が緑・選んだ日は黄)。
//
// マスの中の予定は**押せる物にしない**。iPhone 幅ではマスが 55px ほどで、
// 中の文字をリンクにすると日を選ぶつもりの指が予定を開いてしまう。
// 日を押すとその日の予定が並び (DayPane / DayPopover)、そこから開く
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"] as const;
// 1 マスに出す行 (祝日名 + 予定) の数。超えた分は右下の角に「+N」。
// **マスの高さは予定の数で変えない** (週の行が伸び縮みすると月の見た目が揃わない)。
// 高さ h-22 (88px) は 日付 24 + 行 20 × 3 + 間 1 × 3 + 枠 1 で、行数とは対。
// 日付の文字の大きさは設定で変わるが、行の高さ (leading-6) は変えない
const LINES_PER_DAY = 3;

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
  const { prefs } = useCalendarPrefs();
  return (
    <div className="select-none" data-calendar-grid="">
      <div
        className="grid grid-cols-7 border-t border-l border-gray-200 text-center text-base"
        aria-hidden="true"
      >
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            className="border-r border-b border-gray-200 py-1 text-gray-700"
          >
            {label}
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-7 border-l border-gray-200"
        role="grid"
        aria-label={`${month} の予定`}
      >
        {days.map((day, i) => {
          const events = byDay.get(day) ?? [];
          const inMonth = day.startsWith(month);
          const isToday = day === today;
          const isSelected = day === selected;
          const dayNumber = Number(day.slice(8));
          // 土日・祝日・休日はマスを薄いピンクにする (docs/126 §1-9)
          const holiday = holidayName(day);
          const isWeekend = i % 7 >= 5;
          const eventLines = LINES_PER_DAY - (holiday === null ? 0 : 1);
          const hidden = events.length - eventLines;
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-haspopup="dialog"
              aria-expanded={isSelected}
              aria-label={`${Number(day.slice(5, 7))}月${dayNumber}日${holiday === null ? "" : ` ${holiday}`} ${events.length} 件`}
              data-day={day}
              data-holiday={holiday ?? undefined}
              onClick={(event) => onSelect(day, event.currentTarget)}
              // data-drop-target … 日の一覧の ︙ をこのマスへドラッグ中 (DayEventList が付け外しする)
              className={`relative flex h-22 min-w-0 flex-col items-stretch gap-px overflow-hidden border-r border-b border-gray-200 text-left align-top hover:brightness-95 data-drop-target:ring-4 data-drop-target:ring-blue-500 data-drop-target:ring-inset ${
                holiday !== null || isWeekend ? "bg-pink-50" : "bg-white"
              }`}
            >
              {/* 日付の帯。今日は緑、選んだ日は黄 (SaiSuke2 と同じ) */}
              <span
                className={`shrink-0 px-1 leading-6 ${DATE_SIZE_CLASS[prefs.dateSize]} ${
                  isSelected ? "bg-yellow-200" : isToday ? "bg-green-300" : ""
                } ${inMonth ? "text-gray-900" : "text-gray-400"}`}
              >
                {dayNumber}
              </span>
              {holiday !== null && (
                <span className="shrink-0 truncate px-0.5 text-sm leading-5 text-gray-900">
                  {holiday}
                </span>
              )}
              {events.slice(0, eventLines).map((event) => {
                const color = eventColor(event, prefs);
                return (
                  <span
                    key={event.itemId}
                    style={color.style}
                    // 色は優先度 (高い 赤・標準 橙・低い 緑)。済みは灰に取り消し線
                    // (日の中では最後に並ぶ。eventsByDay)
                    data-priority={event.priority ?? "normal"}
                    className={`shrink-0 truncate rounded-sm px-0.5 text-sm leading-5 ${color.className} ${
                      event.done ? "line-through" : ""
                    }`}
                  >
                    {event.title || "(無題)"}
                  </span>
                );
              })}
              {hidden > 0 && (
                <span className="absolute right-0 bottom-0 rounded-tl-sm bg-gray-600/80 px-0.5 text-[0.625rem] leading-3 text-white">
                  +{hidden}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
