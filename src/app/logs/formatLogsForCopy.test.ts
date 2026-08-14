import { expect, test } from "vitest";
import type { LogEntry } from "@/lib/logBuffer";
import { formatLogsForCopy } from "./formatLogsForCopy";

// コピーした文字列だけを見て原因に届くかを見る (docs/21-ログ表示計画.md §6)。
// 貼り先 (メモ・チャット) では色バッジが消えるので、level と出所は文字で
// 残っていないと「どれがエラーか」が分からなくなる

// 2026-08-14 12:34:56 JST
const AT = Date.UTC(2026, 7, 14, 3, 34, 56);

test("1 件を見出し行と本文の 2 行にする", () => {
  const logs: LogEntry[] = [
    { at: AT, level: "error", text: "書影を保存できませんでした", source: "server" },
  ];

  expect(formatLogsForCopy(logs)).toBe(
    "[error] サーバ 08/14 12:34:56\n書影を保存できませんでした",
  );
});

test("ブラウザ由来は端末の印を添える", () => {
  const logs: LogEntry[] = [
    {
      at: AT,
      level: "warn",
      text: "モデルを読み込めませんでした",
      source: "browser",
      device: "iPhone",
    },
  ];

  expect(formatLogsForCopy(logs)).toContain("[warn] ブラウザ (iPhone) 08/14");
});

test("端末の印が無いブラウザ由来は括弧を出さない", () => {
  const logs: LogEntry[] = [
    { at: AT, level: "info", text: "埋め込み完了", source: "browser" },
  ];

  expect(formatLogsForCopy(logs)).toContain("[info] ブラウザ 08/14");
});

test("渡された順を保ち、件の間は空行で区切る", () => {
  const logs: LogEntry[] = [
    { at: AT, level: "error", text: "あとの失敗", source: "server" },
    { at: AT - 1000, level: "warn", text: "さきの警告", source: "server" },
  ];

  const text = formatLogsForCopy(logs);
  expect(text.indexOf("あとの失敗")).toBeLessThan(text.indexOf("さきの警告"));
  expect(text).toContain("あとの失敗\n\n[warn]");
});

test("複数行の本文はそのまま保つ", () => {
  const logs: LogEntry[] = [
    { at: AT, level: "error", text: "失敗\n  at foo()\n  at bar()", source: "server" },
  ];

  expect(formatLogsForCopy(logs)).toContain("失敗\n  at foo()\n  at bar()");
});

test("ログが無いときは空文字にする", () => {
  expect(formatLogsForCopy([])).toBe("");
});
