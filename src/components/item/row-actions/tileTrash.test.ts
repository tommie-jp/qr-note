import { expect, test } from "vitest";
import { tileTrashConfirmMessage } from "./tileTrash";

// 画像モードのタイルからゴミ箱へ入れるときの確認文 (docs/107 §7)。
// タイルは画像 1 枚ごとなので、「この画像だけ消える」と読まれないよう
// ノートごと入ることを言う

test("ノートごとゴミ箱へ入ることと、戻せることを言う", () => {
  const message = tileTrashConfirmMessage("12", 1);
  expect(message).toContain("#12");
  expect(message).toContain("ノートごと");
  expect(message).toContain("ゴミ箱から戻せます");
});

test("タイルが 1 枚なら枚数は言わない", () => {
  expect(tileTrashConfirmMessage("12", 1)).not.toMatch(/\d+ 枚/);
});

test("タイルが複数あれば、その枚数がまとめて消えることを言う", () => {
  expect(tileTrashConfirmMessage("12", 3)).toContain("3 枚");
});
