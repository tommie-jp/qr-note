import type { DayEvent } from "../event/monthLayout";
import type { EventPriority } from "../event/parseEvent";

// 予定の帯の色 (docs/126 §1-11)。優先度ごとに薄い色の地に濃い文字。
// 済みは優先度にかかわらず灰 (取り消し線は呼ぶ側が付ける)
const PRIORITY_CLASS: Record<EventPriority, string> = {
  high: "bg-red-200 text-red-950",
  normal: "bg-orange-200 text-orange-950",
  low: "bg-green-200 text-green-950",
};

export function eventColorClass(event: DayEvent): string {
  return event.done ? "bg-gray-200 text-gray-500" : PRIORITY_CLASS[event.priority ?? "normal"];
}
