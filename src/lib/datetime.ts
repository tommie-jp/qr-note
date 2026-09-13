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

// --- 端末のローカル時刻で組む日時 (docs/93-リファクタリング計画.md §3-1) ---
//
// 上の JST 固定とは別物。録音・録画・お絵かき・クリップボードの取り込みで、
// ブラウザが送信前に付ける名前と本文の alt に使う (getHours などの地方時)。
// 4 か所が pad() と組み立てをそれぞれ手書きしていた。

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// 2026-07-20
export function formatLocalDate(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

// 14:03:09 ("second") / 14:03 ("minute")
export function formatLocalTime(
  at: Date,
  precision: "minute" | "second" = "second",
): string {
  const minute = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  return precision === "minute" ? minute : `${minute}:${pad2(at.getSeconds())}`;
}

// 20260720-140309。並べたときに時系列になる、区切りの少ない形
export function formatLocalCompactStamp(at: Date): string {
  const date = `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}`;
  const time = `${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}`;
  return `${date}-${time}`;
}

// 本文の alt に残す「語 + 日時」(`録音 2026-07-20 14:03:09`)。
// UUID 名では失われる手がかりが本文に載り、PGroonga の全文検索から語で引ける。
// `]` `|` と改行は画像記法 (と幅指定 `![alt|200]`) を壊すので、語にも入れないこと
export function timestampLabel(
  word: string,
  at: Date,
  precision: "minute" | "second" = "second",
): string {
  return `${word} ${formatLocalDate(at)} ${formatLocalTime(at, precision)}`;
}

// 送信時の File に付ける名前 (`recording-20260720-140309.webm`)。
// サーバは保存時に UUID を振り直すので名前は残らない — File に名前が要ることと、
// 失敗時のログで何を送ったか判るようにするためのもの
export function timestampFileName(prefix: string, at: Date, ext: string): string {
  return `${prefix}-${formatLocalCompactStamp(at)}.${ext}`;
}
