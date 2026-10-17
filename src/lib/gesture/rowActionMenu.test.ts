import { expect, test } from "vitest";
import {
  ROW_ACTION_MENU_MARGIN,
  placeRowActionMenu,
  placeRowActionMenuAtAnchor,
} from "./rowActionMenu";

// 余裕のある画面と、その真ん中あたりを押した指。個々のテストで
// 「どこが狭いか」だけを変える
const VIEWPORT = { width: 390, height: 800 };
const MENU = { width: 200, height: 100 };
const MARGIN = ROW_ACTION_MENU_MARGIN;

test("押した指の上に出す", () => {
  // 指がメニューを隠さないように上へ逃がす (iOS の触覚メニューと同じ)
  const at = placeRowActionMenu({ x: 195, y: 400 }, MENU, VIEWPORT);
  expect(at.top).toBe(400 - MENU.height - MARGIN);
});

test("横は押した指の中心に揃える", () => {
  const at = placeRowActionMenu({ x: 195, y: 400 }, MENU, VIEWPORT);
  expect(at.left).toBe(195 - MENU.width / 2);
});

test("上に入らなければ指の下へ回す", () => {
  // 一覧の 1 行目を長押しした場合。上へ出すと画面の外に消える
  const at = placeRowActionMenu({ x: 195, y: 40 }, MENU, VIEWPORT);
  expect(at.top).toBe(40 + MARGIN);
});

test("右端で押しても画面からはみ出さない", () => {
  const at = placeRowActionMenu({ x: 385, y: 400 }, MENU, VIEWPORT);
  expect(at.left).toBe(VIEWPORT.width - MENU.width - MARGIN);
});

test("左端で押しても余白を割らない", () => {
  const at = placeRowActionMenu({ x: 5, y: 400 }, MENU, VIEWPORT);
  expect(at.left).toBe(MARGIN);
});

test("上下どちらにも入らなければ画面の中へ収める", () => {
  // 横持ちの小さい画面 + 項目の多いメニュー。押した位置は諦めて、
  // 少なくとも全部が見える場所に置く
  const tall = { width: 200, height: 300 };
  const shallow = { width: 390, height: 320 };
  const at = placeRowActionMenu({ x: 195, y: 160 }, tall, shallow);
  expect(at.top).toBeGreaterThanOrEqual(MARGIN);
  expect(at.top + tall.height).toBeLessThanOrEqual(shallow.height - MARGIN);
});

test("メニューが画面より大きくても左上を画面内に置く", () => {
  // 端末を横にしてメニューが縦に入りきらない場合。ここで負の座標を返すと
  // 上端が切れて 1 つ目の項目が押せなくなる
  const huge = { width: 500, height: 900 };
  const at = placeRowActionMenu({ x: 195, y: 400 }, huge, VIEWPORT);
  expect(at.left).toBe(MARGIN);
  expect(at.top).toBe(MARGIN);
});

// ⋮ ボタンから開いたとき (docs/107-行メニュー計画.md §4)。起点は指の点ではなく
// ボタンの矩形で、メニューはボタンの真下に右端を揃えて出す
// (Gmail や Google Drive の ⋮ と同じ)。
const BUTTON = { left: 340, top: 300, right: 380, bottom: 340 };

test("⋮ のメニューはボタンの真下に出す", () => {
  const at = placeRowActionMenuAtAnchor(BUTTON, MENU, VIEWPORT);
  expect(at.top).toBe(BUTTON.bottom);
});

test("⋮ のメニューは右端をボタンの右端に揃える", () => {
  const at = placeRowActionMenuAtAnchor(BUTTON, MENU, VIEWPORT);
  expect(at.left).toBe(BUTTON.right - MENU.width);
});

test("⋮ の下に入らなければボタンの上へ回す", () => {
  // 一覧の最後の行。下へ出すと画面の外に消える
  const low = { left: 340, top: 740, right: 380, bottom: 780 };
  const at = placeRowActionMenuAtAnchor(low, MENU, VIEWPORT);
  expect(at.top).toBe(low.top - MENU.height);
});

test("⋮ が左寄りでも余白を割らない", () => {
  // 狭い画面でボタンより広いメニューを右揃えにすると左へはみ出す
  const left = { left: 0, top: 300, right: 40, bottom: 340 };
  const at = placeRowActionMenuAtAnchor(left, MENU, VIEWPORT);
  expect(at.left).toBe(MARGIN);
});

test("⋮ の上下どちらにも入らなければ画面の中へ収める", () => {
  const tall = { width: 200, height: 300 };
  const shallow = { width: 390, height: 320 };
  const mid = { left: 340, top: 140, right: 380, bottom: 180 };
  const at = placeRowActionMenuAtAnchor(mid, tall, shallow);
  expect(at.top).toBeGreaterThanOrEqual(MARGIN);
  expect(at.top + tall.height).toBeLessThanOrEqual(shallow.height - MARGIN);
});
