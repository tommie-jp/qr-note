import { expect, test } from "vitest";
import { ROW_ACTION_MENU_MARGIN, placeRowActionMenu } from "./rowActionMenu";

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
