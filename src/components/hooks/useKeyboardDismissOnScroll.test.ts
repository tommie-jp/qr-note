import { expect, test, vi } from "vitest";
import {
  subscribeKeyboardDismiss,
  type TouchTarget,
} from "./useKeyboardDismissOnScroll";

type Listener = (event: Pick<TouchEvent, "target">) => void;

// window の代わりに、張られたリスナーを種類ごとに手元に持つだけの偽物
function fakeTarget() {
  const listeners = {
    touchstart: new Set<Listener>(),
    touchmove: new Set<Listener>(),
  };
  const target: TouchTarget = {
    addEventListener: (type, listener) => {
      listeners[type].add(listener);
    },
    removeEventListener: (type, listener) => {
      listeners[type].delete(listener);
    },
  };
  // 指を置いて (touchstart) 動かす (touchmove)。target は置いた場所
  const drag = (at: EventTarget | null) => {
    listeners.touchstart.forEach((listener) => listener({ target: at }));
    listeners.touchmove.forEach((listener) => listener({ target: at }));
  };
  return { target, listeners, drag };
}

const INSIDE = { name: "form" } as unknown as EventTarget;
const OUTSIDE = { name: "results" } as unknown as EventTarget;
const isInside = (node: EventTarget | null) => node === INSIDE;

test("外で始まった指の動きでキーボードを閉じる", () => {
  // Arrange
  const { target, drag } = fakeTarget();
  const dismiss = vi.fn();
  subscribeKeyboardDismiss(target, isInside, dismiss);

  // Act
  drag(OUTSIDE);

  // Assert
  expect(dismiss).toHaveBeenCalledTimes(1);
});

test("フォームの中で始まった指の動き (文字列選択) では閉じない", () => {
  // Arrange
  const { target, drag } = fakeTarget();
  const dismiss = vi.fn();
  subscribeKeyboardDismiss(target, isInside, dismiss);

  // Act
  drag(INSIDE);

  // Assert
  expect(dismiss).not.toHaveBeenCalled();
});

test("始点は touchstart ごとに覚え直す (中 → 外の順でも外は閉じる)", () => {
  // Arrange
  const { target, drag } = fakeTarget();
  const dismiss = vi.fn();
  subscribeKeyboardDismiss(target, isInside, dismiss);

  // Act
  drag(INSIDE);
  drag(OUTSIDE);

  // Assert
  expect(dismiss).toHaveBeenCalledTimes(1);
});

test("返した関数で両方のリスナーを外す", () => {
  // Arrange
  const { target, listeners, drag } = fakeTarget();
  const dismiss = vi.fn();
  const unsubscribe = subscribeKeyboardDismiss(target, isInside, dismiss);

  // Act
  unsubscribe();
  drag(OUTSIDE);

  // Assert
  expect(listeners.touchstart.size).toBe(0);
  expect(listeners.touchmove.size).toBe(0);
  expect(dismiss).not.toHaveBeenCalled();
});
