"use client";

import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  AUTO_TEXT,
  DATE_SIZES,
  DEFAULT_CALENDAR_PREFS,
  eventTextColor,
  MAX_EVENTS_PER_DAY,
  MIN_EVENTS_PER_DAY,
  SIDE_PADDINGS,
  TEMPLATE_COLORS,
  TEXT_TEMPLATE_COLORS,
  type CalendarPrefs,
} from "../event/calendarPrefs";
import type { EventPriority } from "../event/parseEvent";
import { placeAround, type Placement } from "../event/placePopover";
import { updateCalendarPrefs, useCalendarPrefs } from "./prefsStore";
import { useDismissOnOutside } from "./useDismissOnOutside";

const PRIORITY_ROWS: readonly { value: EventPriority; label: string }[] = [
  { value: "high", label: "高い" },
  { value: "normal", label: "標準" },
  { value: "low", label: "低い" },
];

const EVENTS_PER_DAY_OPTIONS = Array.from(
  { length: MAX_EVENTS_PER_DAY - MIN_EVENTS_PER_DAY + 1 },
  (_, i) => MIN_EVENTS_PER_DAY + i,
);

// 並んだ釦から 1 つ選ぶ欄 (文字の大きさ・左右の余白)
function ChoiceField<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-gray-600">{legend}</legend>
      <div className="flex gap-1">
        {options.map((size) => (
          <button
            key={size.value}
            type="button"
            aria-pressed={value === size.value}
            onClick={() => onChange(size.value)}
            className={`min-h-9 flex-1 rounded border ${
              value === size.value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300 text-gray-800 hover:bg-gray-50"
            }`}
          >
            {size.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="size-5">
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" strokeLinecap="round" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

// カレンダー専用の設定 (docs/126 §1-12)。月の見出し行の左端のアイコンで開く。
// 日付と予定の文字の大きさ、月の左右の余白、1 日の予定数、優先度ごとの色 (テンプレート色かカラーピッカー)。
// 変えた値はすぐマス目に当たり、保存は裏で行う (prefsStore)。
// パネルは body へ portal する (DayPopover と同じ理由)
export function CalendarMenu() {
  // 開いているときは押した釦 (パネルを置く基準)。閉じていれば null
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label="カレンダーの設定"
        title="カレンダーの設定"
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(e) => {
          const button = e.currentTarget;
          setAnchor((current) => (current === null ? button : null));
        }}
        className="flex min-h-8 min-w-8 items-center justify-center rounded border border-gray-300 text-gray-700 hover:bg-gray-100 active:bg-gray-200"
      >
        <SettingsIcon />
      </button>
      {anchor !== null && <SettingsPanel anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}

// パネルを開いた釦のそばに置く。描いた直後に測る (置く前の 1 フレームを見せない)
function usePanelPlacement(ref: RefObject<HTMLDivElement | null>, anchor: HTMLElement): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (box === null) {
      return;
    }
    setPlacement(
      placeAround(
        anchor.getBoundingClientRect(),
        { width: box.offsetWidth, height: box.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor, ref]);
  return placement;
}

type ChangePrefs = (patch: Partial<CalendarPrefs>) => void;

// 文字の大きさ・左右の余白・1 日の予定数
function LayoutFields({ prefs, change }: { prefs: CalendarPrefs; change: ChangePrefs }) {
  return (
    <>
      <ChoiceField
        legend="日付の文字の大きさ"
        options={DATE_SIZES}
        value={prefs.dateSize}
        onChange={(dateSize) => change({ dateSize })}
      />
      <ChoiceField
        legend="予定の文字の大きさ"
        options={DATE_SIZES}
        value={prefs.eventSize}
        onChange={(eventSize) => change({ eventSize })}
      />
      <ChoiceField
        legend="月の左右の余白"
        options={SIDE_PADDINGS}
        value={prefs.sidePadding}
        onChange={(sidePadding) => change({ sidePadding })}
      />
      {/* 1 マスの行数。マスの高さはこの行数で固定する (docs/126 §1-19) */}
      <label className="flex items-center justify-between gap-2">
        <span className="text-gray-600">1 日に出す予定の数</span>
        <select
          value={prefs.eventsPerDay}
          onChange={(e) => change({ eventsPerDay: Number(e.target.value) })}
          className="min-h-9 rounded border border-gray-300 bg-white px-2 text-gray-800"
        >
          {EVENTS_PER_DAY_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

interface PriorityRowProps {
  row: (typeof PRIORITY_ROWS)[number];
  // 欄の id の頭 (useId)
  id: string;
  // 地の色・文字の色 (AUTO_TEXT なら自動)・実際に見せる文字の色
  current: string;
  text: string;
  shownText: string;
  setColor: (priority: EventPriority, color: string) => void;
  setTextColor: (priority: EventPriority, color: string) => void;
}

// 地の色: 見本の帯・カラーピッカー・テンプレート色
function BackgroundColorFields({ row, id, current, shownText, setColor }: PriorityRowProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="w-10">{row.label}</span>
        {/* 見本の帯。地と文字の組み合わせをそのまま見せる */}
        <span
          aria-hidden="true"
          className="h-6 flex-1 rounded-sm border border-gray-300 px-1 text-sm leading-6"
          style={{ backgroundColor: current, color: shownText }}
        >
          予定
        </span>
        <label htmlFor={`${id}-${row.value}`} className="sr-only">
          {row.label}の色を選ぶ
        </label>
        <input
          id={`${id}-${row.value}`}
          type="color"
          value={current}
          onChange={(e) => setColor(row.value, e.target.value)}
          title="色を選ぶ"
          className="h-8 w-10 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
        />
      </div>
      <div className="flex flex-wrap gap-1 pl-12">
        {TEMPLATE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`${row.label}を ${color} にする`}
            aria-pressed={current === color}
            title={color}
            onClick={() => setColor(row.value, color)}
            className={`size-6 rounded-sm border ${
              current === color ? "border-gray-900 ring-2 ring-blue-500" : "border-gray-300"
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </>
  );
}

// 文字の色: 自動・テンプレート色・カラーピッカー
function TextColorFields({ row, id, current, text, shownText, setTextColor }: PriorityRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 pl-12">
      <span className="mr-1 text-gray-600">文字</span>
      <button
        type="button"
        aria-label={`${row.label}の文字を自動にする`}
        aria-pressed={text === AUTO_TEXT}
        onClick={() => setTextColor(row.value, AUTO_TEXT)}
        className={`h-6 rounded-sm border px-1 text-xs ${
          text === AUTO_TEXT ? "border-gray-900 ring-2 ring-blue-500" : "border-gray-300"
        }`}
      >
        自動
      </button>
      {TEXT_TEMPLATE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`${row.label}の文字を ${color} にする`}
          aria-pressed={text === color}
          title={color}
          onClick={() => setTextColor(row.value, color)}
          className={`flex size-6 items-center justify-center rounded-sm border text-sm font-bold ${
            text === color ? "border-gray-900 ring-2 ring-blue-500" : "border-gray-300"
          }`}
          // 地の上に字で見せる (白い字も見える)
          style={{ backgroundColor: current, color }}
        >
          あ
        </button>
      ))}
      <label htmlFor={`${id}-${row.value}-text`} className="sr-only">
        {row.label}の文字の色を選ぶ
      </label>
      <input
        id={`${id}-${row.value}-text`}
        type="color"
        value={shownText}
        onChange={(e) => setTextColor(row.value, e.target.value)}
        title="文字の色を選ぶ"
        className="h-7 w-9 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
      />
    </div>
  );
}

// 優先度の色 (地と文字。優先度ごとに 1 組)
function PriorityColorFields({ prefs, id, change }: { prefs: CalendarPrefs; id: string; change: ChangePrefs }) {
  const setColor = (priority: EventPriority, color: string) =>
    change({ colors: { ...prefs.colors, [priority]: color.toLowerCase() } });
  // 文字の色。AUTO_TEXT なら地の明るさから選ぶ
  const setTextColor = (priority: EventPriority, color: string) =>
    change({ textColors: { ...prefs.textColors, [priority]: color.toLowerCase() } });
  return (
    <fieldset className="space-y-3">
      <legend className="text-gray-600">優先度の色</legend>
      {PRIORITY_ROWS.map((row) => {
        const rowProps: PriorityRowProps = {
          row,
          id,
          current: prefs.colors[row.value],
          text: prefs.textColors[row.value],
          shownText: eventTextColor(prefs, row.value),
          setColor,
          setTextColor,
        };
        return (
          <div key={row.value} className="space-y-1" role="group" aria-label={`${row.label}の色`}>
            <BackgroundColorFields {...rowProps} />
            {/* 文字の色。「自動」は地の明るさから白か濃い灰を選ぶ */}
            <TextColorFields {...rowProps} />
          </div>
        );
      })}
    </fieldset>
  );
}

function SettingsPanel({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const placement = usePanelPlacement(ref, anchor);
  const { prefs, error } = useCalendarPrefs();
  const change = (patch: Partial<CalendarPrefs>) => updateCalendarPrefs({ ...prefs, ...patch });

  // 外を押す・Esc で閉じる。開いた釦を押したときは釦の側が閉じる
  useDismissOnOutside(ref, anchor, onClose);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="カレンダーの設定"
      style={
        placement === null
          ? { left: 0, top: 0, visibility: "hidden" }
          : { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
      }
      className="fixed z-40 w-80 max-w-[calc(100vw-1rem)] space-y-4 overflow-y-auto rounded border border-gray-300 bg-white p-3 text-sm shadow-xl"
    >
      <LayoutFields prefs={prefs} change={change} />

      <PriorityColorFields prefs={prefs} id={id} change={change} />

      {error !== null && (
        <p role="alert" className="rounded bg-yellow-50 px-2 py-1 text-yellow-800">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => updateCalendarPrefs(DEFAULT_CALENDAR_PREFS)}
          className="min-h-9 rounded px-3 text-gray-700 hover:bg-gray-100"
        >
          既定に戻す
        </button>
      </div>
    </div>,
    document.body,
  );
}
