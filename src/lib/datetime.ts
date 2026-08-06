// タイムスタンプ表示は JST 固定・ゼロ埋め (例: 2016/07/07 09:05:03)。
// サーバの TZ / ロケール既定に依存しないよう明示する。
// hourCycle: "h23" で深夜 0 時台を 24 時ではなく 00 時にする
const JST_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
};

export function formatJstDateTime(date: Date): string {
  return date.toLocaleString("ja-JP", JST_FORMAT);
}

// 日付だけの JST 表記 (例: 2026-08-06)。エクスポートしたファイル名に使う
// (docs/28-エクスポート計画.md §7)。ロケール "sv-SE" を選ぶのは、ゼロ埋めの
// YYYY-MM-DD をそのまま返す数少ない既定書式だから (en-CA も同じ形)。
export function formatJstDate(date: Date): string {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
