import type { CSSProperties } from "react";
import { eventTextColor, type CalendarPrefs } from "../event/calendarPrefs";
import type { DayEvent } from "../event/monthLayout";

// 予定の帯の色 (docs/126 §1-11・§1-12)。優先度ごとの地の色は利用者が選ぶ
// (カレンダーの設定)。任意の色なので Tailwind のクラスでなく style で当てる。
// 文字の色も選べる (既定は自動 = 地の明るさから決める)。済みは優先度にかかわらず灰 (取り消し線は
// 呼ぶ側が付ける)
const DONE_CLASS = "bg-gray-200 text-gray-500";

export function eventColor(event: DayEvent, prefs: CalendarPrefs): { className: string; style?: CSSProperties } {
  if (event.done) {
    return { className: DONE_CLASS };
  }
  const priority = event.priority ?? "normal";
  return { className: "", style: { backgroundColor: prefs.colors[priority], color: eventTextColor(prefs, priority) } };
}
