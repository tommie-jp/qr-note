import type { DateSize } from "../event/calendarPrefs";

// マス目の日付の文字の大きさ (カレンダーの設定。docs/126 §1-12)。
// クラス名はリテラルで書く (Tailwind はソース中の完全なクラス名しか拾わない)。
// 行の高さは呼ぶ側が leading-6 で固定するので、大でもマスの高さは変わらない
export const DATE_SIZE_CLASS: Record<DateSize, string> = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-2xl",
};

// マス目の予定の文字の大きさ (docs/126 §1-18)。小 12px / 中 14px (既定) / 大 16px。
// 行の高さ (leading-5 = 20px) は変えない — 1 マス 3 行とマスの高さ 88px は対なので、
// 大きくしても行は増減しない (大は 1 行の文字数が減るだけ)
export const EVENT_SIZE_CLASS: Record<DateSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};
