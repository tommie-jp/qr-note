import type { LogEntry } from "@/lib/logBuffer";

// /logs の中身を貼り付け用のプレーンテキストにする (docs/21-ログ表示計画.md §6)。
//
// サーバの TZ (コンテナは UTC) に依存させず、常に日本時間で出す。
// 画面 (page.tsx) と同じ形にしておくと、コピーした文字列と画面を見比べられる
export const LOG_TIME_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// 貼り先 (メモ・チャット) では色バッジが落ちるので、level と出所は文字で残す。
// 本文は改行を含むため、見出しは本文と別の行に置く (1 行に詰めると
// スタックトレースの 2 行目以降が見出しから離れて読めなくなる)
function formatEntry(log: LogEntry): string {
  const source =
    log.source === "browser"
      ? `ブラウザ${log.device ? ` (${log.device})` : ""}`
      : "サーバ";

  return `[${log.level}] ${source} ${LOG_TIME_FORMAT.format(log.at)}\n${log.text}`;
}

// 並びは呼び手 (recentLogs) のまま。画面と同じ新しい順で渡ってくる
export function formatLogsForCopy(logs: readonly LogEntry[]): string {
  return logs.map(formatEntry).join("\n\n");
}
