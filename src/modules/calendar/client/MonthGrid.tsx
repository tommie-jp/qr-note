"use client";

import { dayProgress, type DayProgress } from "../event/dayProgress";
import { holidayName } from "../event/holidays";
import type { DayEvent } from "../event/monthLayout";
import { DATE_SIZE_CLASS, EVENT_SIZE_CLASS } from "./dateSize";
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
// 1 マスに出す行 (祝日名 + 予定) の数は設定 (eventsPerDay、3〜20)。超えた分は右下の角に「+N」。
// **マスの高さは予定の数で変えない** (週の行が伸び縮みすると月の見た目が揃わない)。
// 高さは 日付 24 + 行 20 × N + 間 1 × N + 枠 1 で、行数とは対 (3 行で 88px)。
// 行を増やすと月は画面より縦に長くなり、送って見る前提 (docs/126 §1-19)。
// 日付・予定の文字の大きさは設定で変わるが、行の高さ (leading-6・leading-5) は変えない
export function cellHeightPx(lines: number): number {
  return 25 + 21 * lines;
}

// 月の左右の余白 (docs/126 §1-19)。結果の器は画面の余白 (px-safe、1rem か safe-area の
// 大きいほう) まで広がっている (-mx-safe px-safe)。マス目だけをそこへ出し、残す余白を
// 0 / 8px / 16px にする。safe-area (iPhone の切り欠き) より内へは出さない
// 日付の右に寄せる進み具合 (docs/126 §1-21)。すべて済みは ✓、残りがあれば「残n」。
// 日付の大きさの設定に関わらず 12px (マスの幅は iPhone で 55px ほどしかない)
function ProgressMark({ progress }: { progress: DayProgress | null }) {
  if (progress === null) {
    return null;
  }
  if (progress.kind === "done") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        data-day-progress="done"
        className="size-4 shrink-0 text-emerald-600"
      >
        <path d="M4.5 12.5l5 5 10-11" />
      </svg>
    );
  }
  return (
    <span aria-hidden="true" data-day-progress="left" className="shrink-0 text-xs leading-6 text-gray-700">
      残{progress.count}
    </span>
  );
}

function progressLabel(progress: DayProgress | null): string {
  if (progress === null) {
    return "";
  }
  return progress.kind === "done" ? " すべて済み" : ` 残り ${progress.count} 件`;
}

const SIDE_PADDING_LENGTH = { none: "0px", sm: "0.5rem", md: "1rem" } as const;

function bleed(side: "left" | "right", keep: string): string {
  const inset = `env(safe-area-inset-${side})`;
  return `calc(max(${keep}, ${inset}) - max(1rem, ${inset}))`;
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
  const { prefs } = useCalendarPrefs();
  const keep = SIDE_PADDING_LENGTH[prefs.sidePadding];
  const height = cellHeightPx(prefs.eventsPerDay);
  return (
    <div
      className="select-none"
      data-calendar-grid=""
      style={{ marginLeft: bleed("left", keep), marginRight: bleed("right", keep) }}
    >
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
          const eventLines = prefs.eventsPerDay - (holiday === null ? 0 : 1);
          const hidden = events.length - eventLines;
          const progress = dayProgress(events);
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-haspopup="dialog"
              aria-expanded={isSelected}
              aria-label={`${Number(day.slice(5, 7))}月${dayNumber}日${holiday === null ? "" : ` ${holiday}`} ${events.length} 件${progressLabel(progress)}`}
              data-day={day}
              data-holiday={holiday ?? undefined}
              onClick={(event) => onSelect(day, event.currentTarget)}
              style={{ height }}
              // data-drop-target … 日の一覧の ︙ をこのマスへドラッグ中 (DayEventList が付け外しする)
              className={`relative flex min-w-0 flex-col items-stretch gap-px overflow-hidden border-r border-b border-gray-200 text-left align-top hover:brightness-95 data-drop-target:ring-4 data-drop-target:ring-blue-500 data-drop-target:ring-inset ${
                holiday !== null || isWeekend ? "bg-pink-50" : "bg-white"
              }`}
            >
              {/* 日付の帯。今日は緑、選んだ日は黄 (SaiSuke2 と同じ) */}
              <span
                className={`flex shrink-0 items-center justify-between gap-0.5 px-1 leading-6 ${DATE_SIZE_CLASS[prefs.dateSize]} ${
                  isSelected ? "bg-yellow-200" : isToday ? "bg-green-300" : ""
                } ${inMonth ? "text-gray-900" : "text-gray-400"}`}
              >
                {dayNumber}
                <ProgressMark progress={progress} />
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
                    className={`shrink-0 truncate rounded-sm px-0.5 leading-5 ${EVENT_SIZE_CLASS[prefs.eventSize]} ${color.className} ${
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
