import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { useLatest } from "./useLatest";

// jsdom は無い (vitest.config.ts の environment: 'node')。静的描画の中で
// フックを 1 度呼び、返った ref を外へ取り出して見る。useEffect は SSR では
// 走らないので、ここで確かめられるのは「最初の描画で既に値を持っている」まで
function refOf<T>(value: T) {
  const captured: Array<{ readonly current: T }> = [];
  function Probe() {
    captured.push(useLatest(value));
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return captured[0];
}

test("最初の描画から渡した値を持つ (effect を待たずに読める)", () => {
  // Arrange
  const handlers = { onError: () => undefined };

  // Act
  const ref = refOf(handlers);

  // Assert
  expect(ref.current).toBe(handlers);
});

test("null や関数もそのまま持つ", () => {
  // Arrange
  const fn = () => 1;

  // Act / Assert
  expect(refOf(null).current).toBeNull();
  expect(refOf(fn).current).toBe(fn);
});
