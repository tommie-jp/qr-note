import { expect, test } from "vitest";
import { lockScroll } from "./useBodyScrollLock";

test("掛けている間は overflow を hidden にする", () => {
  // Arrange
  const body = { style: { overflow: "" } };

  // Act
  lockScroll(body);

  // Assert
  expect(body.style.overflow).toBe("hidden");
});

test("外すと掛ける前の値へ戻す (空文字に決め打ちしない)", () => {
  // Arrange
  const body = { style: { overflow: "scroll" } };
  const unlock = lockScroll(body);

  // Act
  unlock();

  // Assert
  expect(body.style.overflow).toBe("scroll");
});

test("重ねて掛けても、外した順に元の値へ戻る", () => {
  // Arrange
  const body = { style: { overflow: "auto" } };
  const unlockOuter = lockScroll(body);
  const unlockInner = lockScroll(body);

  // Act
  unlockInner();
  const afterInner = body.style.overflow;
  unlockOuter();

  // Assert
  expect(afterInner).toBe("hidden");
  expect(body.style.overflow).toBe("auto");
});
