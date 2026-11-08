import type { DateSize } from "../event/calendarPrefs";

// マス目の日付の文字の大きさ (カレンダーの設定。docs/126 §1-12)。
// クラス名はリテラルで書く (Tailwind はソース中の完全なクラス名しか拾わない)。
// 行の高さは呼ぶ側が leading-6 で固定するので、大でもマスの高さは変わらない
export const DATE_SIZE_CLASS: Record<DateSize, string> = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-2xl",
};
