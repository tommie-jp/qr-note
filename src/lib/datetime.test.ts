import { describe, expect, test } from "vitest";
import {
  agoLabelJa,
  formatJstDateTimeAgo,
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

describe("今からどれだけ前か", () => {
  const now = new Date("2026-11-17T10:57:45Z");
  const before = (ms: number) => new Date(now.getTime() - ms);
  const MINUTE = 60_000;

  test("1 分未満と未来は「いま」、以降は分・時間・日で切り捨てる", () => {
    expect(agoLabelJa(before(59_000), now)).toBe("いま");
    expect(agoLabelJa(before(-5 * MINUTE), now)).toBe("いま");
    expect(agoLabelJa(before(5 * MINUTE), now)).toBe("5分前");
    expect(agoLabelJa(before(59 * MINUTE), now)).toBe("59分前");
    expect(agoLabelJa(before(60 * MINUTE), now)).toBe("1時間前");
    expect(agoLabelJa(before(24 * 60 * MINUTE - 1), now)).toBe("23時間前");
    expect(agoLabelJa(before(10 * 24 * 60 * MINUTE), now)).toBe("10日前");
  });

  test("絶対時刻の後ろに括弧で添え、now が無ければ絶対時刻だけ", () => {
    const at = before(5 * MINUTE);
    expect(formatJstDateTimeAgo(at, now)).toBe("2026/11/17 19:52:45(5分前)");
    expect(formatJstDateTimeAgo(at, null)).toBe("2026/11/17 19:52:45");
  });
});
