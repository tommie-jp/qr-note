import { describe, expect, test } from "vitest";
import {
  formatJstDateTime,
  formatLocalCompactStamp,
  formatLocalDate,
  formatLocalTime,
  timestampFileName,
  timestampLabel,
} from "./datetime";

test("年月日時分秒を JST・ゼロ埋めで表示する", () => {
  // 2016-07-07T00:05:03Z は JST で 09:05:03
  const d = new Date("2016-07-07T00:05:03Z");
  expect(formatJstDateTime(d)).toBe("2016/07/07 09:05:03");
});

test("深夜 0 時台は 24 時ではなく 00 時と表示する", () => {
  // 2026-07-14T15:53:16Z は JST で翌日 00:53:16
  const d = new Date("2026-07-14T15:53:16Z");
  expect(formatJstDateTime(d)).toBe("2026/07/15 00:53:16");
});

// ローカル時刻の要素から組むので、端末のタイムゾーンに依らず同じ文字列になる
// (new Date(年, 月-1, 日, 時, 分, 秒) は実行環境の地方時)
describe("ローカル時刻の日時", () => {
  const at = new Date(2026, 6, 20, 14, 3, 9);
  const padded = new Date(2026, 0, 2, 3, 4, 5);

  test("日付を YYYY-MM-DD にゼロ埋めする", () => {
    expect(formatLocalDate(at)).toBe("2026-07-20");
    expect(formatLocalDate(padded)).toBe("2026-01-02");
  });

  test("時刻は既定で秒まで、minute なら分まで", () => {
    expect(formatLocalTime(at)).toBe("14:03:09");
    expect(formatLocalTime(at, "minute")).toBe("14:03");
    expect(formatLocalTime(padded)).toBe("03:04:05");
  });

  test("深夜 0 時台は 00 時", () => {
    expect(formatLocalTime(new Date(2026, 0, 1, 0, 0, 0))).toBe("00:00:00");
  });

  test("区切りの少ない形は YYYYMMDD-HHMMSS", () => {
    expect(formatLocalCompactStamp(at)).toBe("20260720-140309");
    expect(formatLocalCompactStamp(padded)).toBe("20260102-030405");
  });

  test("alt 用のラベルは「語 日付 時刻」", () => {
    expect(timestampLabel("録音", at)).toBe("録音 2026-07-20 14:03:09");
    expect(timestampLabel("お絵かき", at, "minute")).toBe("お絵かき 2026-07-20 14:03");
  });

  test("ファイル名は「接頭辞-日時.拡張子」", () => {
    expect(timestampFileName("recording", at, "webm")).toBe(
      "recording-20260720-140309.webm",
    );
    expect(timestampFileName("clipboard", padded, "png")).toBe(
      "clipboard-20260102-030405.png",
    );
  });
});
