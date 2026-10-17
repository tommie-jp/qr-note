import { expect, test } from "vitest";
import { tileTrashConfirmMessage } from "./tileTrash";

// 画像モードのタイルからゴミ箱へ入れるときの確認文 (docs/107 §7)。
// タイルは画像 1 枚ごとなので、「この画像だけ消える」と読まれないよう
// ノートごと入ることを言う。名乗りは呼び名 (lib/items/noteName.ts)

test("ノートごとゴミ箱へ入ることと、戻せることを言う", () => {
  const message = tileTrashConfirmMessage("「抵抗」", 1);
  expect(message).toContain("「抵抗」をノートごとゴミ箱へ移動します");
  expect(message).toContain("ゴミ箱から戻せます");
  expect(message).not.toContain("#");
});

test("見出しの無いノートは無題のノートとして名乗る", () => {
  expect(tileTrashConfirmMessage("無題のノート", 1)).toContain("無題のノートをノートごと");
});

test("タイルが 1 枚なら枚数は言わない", () => {
  expect(tileTrashConfirmMessage("「抵抗」", 1)).not.toMatch(/\d+ 枚/);
});

test("タイルが複数あれば、その枚数がまとめて消えることを言う", () => {
  expect(tileTrashConfirmMessage("「抵抗」", 3)).toContain("3 枚");
});
