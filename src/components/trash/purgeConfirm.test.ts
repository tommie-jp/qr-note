import { expect, test } from "vitest";
import { purgeConfirmMessage } from "./purgeConfirm";

test("元に戻せないこと・番号の再利用・シールの処分を言う", () => {
  const message = purgeConfirmMessage("12");
  expect(message).toContain("#12 を完全に削除します");
  expect(message).toContain("元に戻せず");
  expect(message).toContain("再利用");
  expect(message).toContain("シール");
});

// 画像表示のタイルから消すときは、同じノートの他のタイルも消える
test("タイルが複数あれば、まとめて消える枚数を言う", () => {
  expect(purgeConfirmMessage("12", 3)).toContain("3 枚");
  expect(purgeConfirmMessage("12", 1)).not.toMatch(/\d+ 枚/);
});
