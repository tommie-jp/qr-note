import { expect, test, vi } from "vitest";
import { subscribeEscape, type KeydownTarget } from "./useEscapeKey";

type Listener = (event: Pick<KeyboardEvent, "key">) => void;

// window の代わりに、張られたリスナーを手元に持つだけの偽物
function fakeTarget() {
  const listeners = new Set<Listener>();
  const target: KeydownTarget = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  const press = (key: string) => {
    listeners.forEach((listener) => listener({ key }));
  };
  return { target, listeners, press };
}

test("Escape を押すと onEscape を呼ぶ", () => {
  // Arrange
  const { target, press } = fakeTarget();
  const onEscape = vi.fn();
  subscribeEscape(target, onEscape);

  // Act
  press("Escape");

  // Assert
  expect(onEscape).toHaveBeenCalledTimes(1);
});

test("Escape 以外のキーでは呼ばない", () => {
  // Arrange
  const { target, press } = fakeTarget();
  const onEscape = vi.fn();
  subscribeEscape(target, onEscape);

  // Act
  press("Enter");
  press("Esc");

  // Assert
  expect(onEscape).not.toHaveBeenCalled();
});

test("返した関数でリスナーを外すと、以後は呼ばない", () => {
  // Arrange
  const { target, listeners, press } = fakeTarget();
  const onEscape = vi.fn();
  const unsubscribe = subscribeEscape(target, onEscape);

  // Act
  unsubscribe();
  press("Escape");

  // Assert
  expect(listeners.size).toBe(0);
  expect(onEscape).not.toHaveBeenCalled();
});
