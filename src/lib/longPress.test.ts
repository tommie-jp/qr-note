import { expect, test } from "vitest";
import {
  hasLeftPressArea,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  LONG_PRESS_MS,
} from "./longPress";

test("指が動いていなければ長押しは続く", () => {
  expect(hasLeftPressArea({ x: 100, y: 200 }, { x: 100, y: 200 })).toBe(false);
});

test("押している間の微動では取り消さない", () => {
  // 押しっぱなしの指は数 px 揺れる。ここで取り消すと長押しが成立しない
  expect(hasLeftPressArea({ x: 100, y: 200 }, { x: 103, y: 196 })).toBe(false);
});

test("許容範囲を超えて動いたらスクロールとみなす", () => {
  expect(hasLeftPressArea({ x: 100, y: 200 }, { x: 100, y: 220 })).toBe(true);
  expect(hasLeftPressArea({ x: 100, y: 200 }, { x: 80, y: 200 })).toBe(true);
});

test("斜めの移動も直線距離で測る", () => {
  // 軸ごとに見ると 8px ずつで閾値内だが、距離は 11.3px で範囲外。
  // 軸で判定すると斜めのスクロールだけ取り消せなくなる
  expect(hasLeftPressArea({ x: 0, y: 0 }, { x: 8, y: 8 })).toBe(true);
});

test("境界のちょうどでは取り消さない", () => {
  const edge = { x: LONG_PRESS_MOVE_TOLERANCE_PX, y: 0 };
  expect(hasLeftPressArea({ x: 0, y: 0 }, edge)).toBe(false);
});

test("許容範囲は呼ぶ側から差し替えられる", () => {
  expect(hasLeftPressArea({ x: 0, y: 0 }, { x: 5, y: 0 }, 3)).toBe(true);
});

test("長押しの待ち時間は 0.3〜1 秒に収まる", () => {
  // 短すぎると触れただけで出て、長すぎると押しても反応しないと感じる
  expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(300);
  expect(LONG_PRESS_MS).toBeLessThanOrEqual(1000);
});
