"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeAroundInView, type Placement } from "../event/placePopover";
import { onVisibleViewChange, visibleView } from "./visibleView";
import { moveStart, quarterHours, type TimeRange } from "../event/timeOptions";

// 終日を外したときの時刻
const DEFAULT_RANGE: TimeRange = { start: "10:00", end: "11:00" };
const NO_END = "";

// 日の一覧の時刻を押したとき、そのそばに出す時刻のパネル (docs/126 §1-14)。
// 終日・開始・終了を 15 分刻みの選択欄で選ぶ。選んだらすぐ onChange (保存は呼ぶ側)。
// range が null なら終日。body へ portal する理由は DayPopover と同じ
export function TimePopover({
  anchor,
  range,
  onChange,
  onClose,
}: {
  anchor: HTMLElement;
  range: TimeRange | null;
  onChange: (range: TimeRange | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [placement, setPlacement] = useState<Placement | null>(null);
  // 終日を切り替えると背が変わるので置き直す
  const allDay = range === null;

  // 置く範囲は見えている範囲 (iPhone のキーボードで縮む。§1-32)
  useLayoutEffect(() => {
    const place = () => {
      const box = ref.current;
      if (box === null) {
        return;
      }
      setPlacement(
        placeAroundInView(
          anchor.getBoundingClientRect(),
          { width: box.offsetWidth, height: box.scrollHeight },
          visibleView(),
        ),
      );
    };
    place();
    return onVisibleViewChange(place);
  }, [anchor, allDay]);

  // 外を押す・Esc で閉じる (Esc はペインの「閉じる」まで届かせない)
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !ref.current?.contains(target) && !anchor.contains(target)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchor, onClose]);

  const field = "min-h-10 rounded border border-gray-300 bg-white px-2 tabular-nums";
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="時刻"
      style={
        placement === null
          ? { left: 0, top: 0, visibility: "hidden" }
          : { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
      }
      className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] space-y-2 overflow-y-auto rounded border border-gray-300 bg-white p-3 text-sm shadow-xl"
    >
      <label className="flex min-h-9 items-center gap-2">
        <input
          type="checkbox"
          checked={range === null}
          onChange={(e) => onChange(e.target.checked ? null : DEFAULT_RANGE)}
          className="size-5"
        />
        終日
      </label>
      {range !== null && (
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-start`} className="block text-gray-600">
              開始
            </label>
            <select
              id={`${id}-start`}
              value={range.start}
              onChange={(e) => onChange(moveStart(range, e.target.value))}
              className={field}
            >
              {quarterHours(range.start).map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </div>
          <span className="pb-2">~</span>
          <div className="space-y-1">
            <label htmlFor={`${id}-end`} className="block text-gray-600">
              終了
            </label>
            <select
              id={`${id}-end`}
              value={range.end ?? NO_END}
              onChange={(e) => onChange({ start: range.start, end: e.target.value === NO_END ? null : e.target.value })}
              className={field}
            >
              <option value={NO_END}>1 時間後</option>
              {quarterHours(range.end)
                .filter((time) => time > range.start)
                .map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
