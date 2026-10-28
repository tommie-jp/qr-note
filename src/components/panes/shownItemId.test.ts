import { expect, test } from "vitest";
import { shownPaneItemId } from "./shownItemId";

test("出しているノートの番号を知らせる", () => {
  expect(
    shownPaneItemId({ visible: true, itemId: "a", source: "detail", pathItemId: "a" }),
  ).toBe("a");
});

test("出していない間は null (閉じたのに行だけ選ばれたまま、にしない)", () => {
  expect(
    shownPaneItemId({ visible: false, itemId: "a", source: "detail", pathItemId: "a" }),
  ).toBeNull();
});

// 先頭のノートが器の裏で生き返らないように (docs/86 §4-18)
test("読み込み中の横取りペインは URL の番号を知らせる", () => {
  expect(
    shownPaneItemId({ visible: true, itemId: undefined, source: "detail", pathItemId: "b" }),
  ).toBe("b");
});

test("自動のペインは URL を見ない", () => {
  expect(
    shownPaneItemId({ visible: true, itemId: undefined, source: "auto", pathItemId: "b" }),
  ).toBeNull();
});
