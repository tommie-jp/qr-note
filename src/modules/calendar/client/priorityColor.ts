import type { CSSProperties } from "react";
import { readableTextColor, type CalendarPrefs } from "../event/calendarPrefs";
import type { DayEvent } from "../event/monthLayout";

// 予定の帯の色 (docs/126 §1-11・§1-12)。優先度ごとの地の色は利用者が選ぶ
// (カレンダーの設定)。任意の色なので Tailwind のクラスでなく style で当てる。
// 文字の色は地の明るさから決める。済みは優先度にかかわらず灰 (取り消し線は
// 呼ぶ側が付ける)
const DONE_CLASS = "bg-gray-200 text-gray-500";

export function eventColor(event: DayEvent, prefs: CalendarPrefs): { className: string; style?: CSSProperties } {
  if (event.done) {
    return { className: DONE_CLASS };
  }
  const background = prefs.colors[event.priority ?? "normal"];
  return { className: "", style: { backgroundColor: background, color: readableTextColor(background) } };
}
