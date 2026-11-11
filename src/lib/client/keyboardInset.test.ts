import { describe, expect, test } from "vitest";
import { keyboardInsetPx, keyboardPaneMaxPx } from "./keyboardInset";

describe("keyboardInsetPx (キーボードが覆う高さ。docs/126 §1-33)", () => {
  test("キーボードが無ければ 0", () => {
    expect(keyboardInsetPx(800, { offsetTop: 0, height: 800 })).toBe(0);
    expect(keyboardInsetPx(800, null)).toBe(0);
  });

  test("見えている範囲の下端からレイアウトの画面の下端まで", () => {
    // 見えている範囲が 450px に縮み、送られていない
    expect(keyboardInsetPx(800, { offsetTop: 0, height: 450 })).toBe(350);
    // さらに 100px 送られている (見えている範囲の下端はレイアウトの 550px)
    expect(keyboardInsetPx(800, { offsetTop: 100, height: 450 })).toBe(250);
  });

  test("負にはしない (拡大などで見えている範囲がはみ出しても)", () => {
    expect(keyboardInsetPx(800, { offsetTop: 400, height: 450 })).toBe(0);
  });
});

describe("keyboardPaneMaxPx (キーボードが出ている間のペインの高さの上限。§1-34)", () => {
  test("見えている範囲からヘッダーの分を引く", () => {
    expect(keyboardPaneMaxPx({ offsetTop: 0, height: 450 }, 120)).toBe(330);
  });

  test("送られてヘッダーが見えていなければ、その分は引かない", () => {
    expect(keyboardPaneMaxPx({ offsetTop: 50, height: 450 }, 120)).toBe(380);
    expect(keyboardPaneMaxPx({ offsetTop: 200, height: 450 }, 120)).toBe(450);
  });
});
