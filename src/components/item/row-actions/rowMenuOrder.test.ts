import { expect, test } from "vitest";
import type { RowAction } from "./RowActions";
import { nextMenuIndex, orderMenuActions } from "./rowMenuOrder";

function action(key: string, danger = false): RowAction {
  return { key, label: key, icon: null, danger, onSelect: () => {} };
}

test("危険な操作は末尾へ寄せ、境に区切り線を 1 本だけ引く", () => {
  const ordered = orderMenuActions([
    action("trash", true),
    action("pin"),
    action("purge", true),
    action("copy"),
  ]);
  expect(ordered.map((o) => o.action.key)).toEqual(["pin", "copy", "trash", "purge"]);
  expect(ordered.map((o) => o.separatorBefore)).toEqual([false, false, true, false]);
});

test("危険な操作しか無いときは区切り線を引かない", () => {
  const ordered = orderMenuActions([action("trash", true)]);
  expect(ordered).toEqual([{ action: expect.objectContaining({ key: "trash" }), separatorBefore: false }]);
});

test("普通の操作しか無いときは区切り線を引かない", () => {
  const ordered = orderMenuActions([action("pin"), action("copy")]);
  expect(ordered.some((o) => o.separatorBefore)).toBe(false);
});

test("↓ は次へ進み、末尾から先頭へ回り込む", () => {
  expect(nextMenuIndex("ArrowDown", 0, 3)).toBe(1);
  expect(nextMenuIndex("ArrowDown", 2, 3)).toBe(0);
});

test("↑ は前へ戻り、先頭から末尾へ回り込む", () => {
  expect(nextMenuIndex("ArrowUp", 1, 3)).toBe(0);
  expect(nextMenuIndex("ArrowUp", 0, 3)).toBe(2);
});

test("どこにも居ないときの ↓ は先頭、↑ は末尾", () => {
  expect(nextMenuIndex("ArrowDown", -1, 3)).toBe(0);
  expect(nextMenuIndex("ArrowUp", -1, 3)).toBe(2);
});

test("Home は先頭、End は末尾", () => {
  expect(nextMenuIndex("Home", 1, 3)).toBe(0);
  expect(nextMenuIndex("End", 1, 3)).toBe(2);
});

test("対象外のキーと空のメニューは null", () => {
  expect(nextMenuIndex("Enter", 0, 3)).toBeNull();
  expect(nextMenuIndex("ArrowDown", -1, 0)).toBeNull();
});
