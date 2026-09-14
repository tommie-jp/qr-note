import { expect, test } from "vitest";
import { prefillTargetFromCode } from "./prefillSummary";

// コードから取得対象を決める分岐。編集中スキャンが「書籍情報 / 商品情報 /
// どちらでもない」を見分ける入口 (isIsbn / isJan の検算は scanRegister 側で網羅)。

test("ISBN (978/979) は書誌の取得対象", () => {
  // 9784873115658 = リーダブルコード (EAN-13 検算 OK)
  expect(prefillTargetFromCode("9784873115658")).toEqual({
    kind: "book",
    code: "9784873115658",
  });
});

test("書籍以外の EAN-13 (JAN) は商品情報の取得対象", () => {
  // 4901777300446 = 書籍ではない JAN
  expect(prefillTargetFromCode("4901777300446")).toEqual({
    kind: "product",
    code: "4901777300446",
  });
});

test("EAN-13 でないコードは取得対象にしない (null)", () => {
  // 部品シールの URL や任意テキストは書籍・商品として引かない
  expect(prefillTargetFromCode("https://qr.tommie.jp/item/1234")).toBeNull();
  expect(prefillTargetFromCode("ABC123")).toBeNull();
  // 桁は合うが検算に落ちる番号も対象外
  expect(prefillTargetFromCode("9784873115659")).toBeNull();
});
