"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AUTO_TEXT,
  DATE_SIZES,
  DEFAULT_CALENDAR_PREFS,
  eventTextColor,
  TEMPLATE_COLORS,
  TEXT_TEMPLATE_COLORS,
  type CalendarPrefs,
} from "../event/calendarPrefs";
import type { EventPriority } from "../event/parseEvent";
import { placeAround, type Placement } from "../event/placePopover";
import { updateCalendarPrefs, useCalendarPrefs } from "./prefsStore";

const PRIORITY_ROWS: readonly { value: EventPriority; label: string }[] = [
  { value: "high", label: "高い" },
  { value: "normal", label: "標準" },
  { value: "low", label: "低い" },
];

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
// 日付の文字の大きさと、優先度ごとの色 (テンプレート色かカラーピッカー)。
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
        className="flex min-h-9 min-w-9 items-center justify-center rounded border border-gray-300 text-gray-700 hover:bg-gray-100 active:bg-gray-200"
      >
        <SettingsIcon />
      </button>
      {anchor !== null && <SettingsPanel anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}

function SettingsPanel({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const { prefs, error } = useCalendarPrefs();
  const change = (patch: Partial<CalendarPrefs>) => updateCalendarPrefs({ ...prefs, ...patch });
  const setColor = (priority: EventPriority, color: string) =>
    change({ colors: { ...prefs.colors, [priority]: color.toLowerCase() } });
  // 文字の色。AUTO_TEXT なら地の明るさから選ぶ
  const setTextColor = (priority: EventPriority, color: string) =>
    change({ textColors: { ...prefs.textColors, [priority]: color.toLowerCase() } });

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
  }, [anchor]);

  // 外を押す・Esc で閉じる。開いた釦を押したときは釦の側が閉じる
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !ref.current?.contains(target) && !anchor.contains(target)) {
        onClose();
      }
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
      <fieldset className="space-y-1">
        <legend className="text-gray-600">日付の文字の大きさ</legend>
        <div className="flex gap-1">
          {DATE_SIZES.map((size) => (
            <button
              key={size.value}
              type="button"
              aria-pressed={prefs.dateSize === size.value}
              onClick={() => change({ dateSize: size.value })}
              className={`min-h-9 flex-1 rounded border ${
                prefs.dateSize === size.value
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-300 text-gray-800 hover:bg-gray-50"
              }`}
            >
              {size.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-gray-600">優先度の色</legend>
        {PRIORITY_ROWS.map((row) => {
          const current = prefs.colors[row.value];
          const text = prefs.textColors[row.value];
          const shownText = eventTextColor(prefs, row.value);
          return (
            <div key={row.value} className="space-y-1" role="group" aria-label={`${row.label}の色`}>
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
              {/* 文字の色。「自動」は地の明るさから白か濃い灰を選ぶ */}
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
            </div>
          );
        })}
      </fieldset>

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
