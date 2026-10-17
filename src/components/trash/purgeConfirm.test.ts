import { expect, test } from "vitest";
import { purgeConfirmMessage } from "./purgeConfirm";

// 呼び名は lib/items/noteName.ts が作る (「抵抗」・無題のノート)。
// id (UUID) は人が読む物ではないので確認文には出さない (docs/107 §4-4)
test("呼び名で名乗り、元に戻せないことを言う", () => {
  const message = purgeConfirmMessage("「抵抗」");
  expect(message).toContain("「抵抗」を完全に削除します");
  expect(message).toContain("元に戻せません");
});

// id は UUID になって再利用されなくなった (docs/107 §5)。番号の再利用や
// シールの処分を問うのは、もう起きないことへの警告になる
test("番号の再利用・シールの処分は言わない", () => {
  const message = purgeConfirmMessage("「抵抗」");
  expect(message).not.toContain("再利用");
  expect(message).not.toContain("シール");
  expect(message).not.toContain("#");
});

test("見出しの無いノートは無題のノートとして名乗る", () => {
  expect(purgeConfirmMessage("無題のノート")).toContain("無題のノートを完全に削除します");
});

// 画像表示のタイルから消すときは、同じノートの他のタイルも消える
test("タイルが複数あれば、まとめて消える枚数を言う", () => {
  expect(purgeConfirmMessage("「抵抗」", 3)).toContain("3 枚");
  expect(purgeConfirmMessage("「抵抗」", 1)).not.toMatch(/\d+ 枚/);
});
