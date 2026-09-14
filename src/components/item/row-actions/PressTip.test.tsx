import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PressTip, tipAlign } from "./PressTip";

test("包みは中身をそのまま出し、PC 用に title を持つ", () => {
  const html = renderToStaticMarkup(
    <PressTip label="このノートを編集する">
      <button type="button">編集</button>
    </PressTip>,
  );
  expect(html).toContain("編集</button>");
  expect(html).toContain('title="このノートを編集する"');
});

// 吹き出しは長押しで初めて出る。最初の描画で出すと、ページを開いた瞬間に
// 説明が画面いっぱいに散らばる
test("押していない間は吹き出しを出さない", () => {
  const html = renderToStaticMarkup(
    <PressTip label="ページ送りをやめる">
      <button type="button">ページ</button>
    </PressTip>,
  );
  expect(html).not.toContain("ページ送りをやめる<");
});

// 長押しは文字の選択と iOS の「コピー / 調べる」を呼ぶので、包みで止める
test("長押しの既定の反応を止める指定を持つ", () => {
  const html = renderToStaticMarkup(
    <PressTip label="x">
      <button type="button">y</button>
    </PressTip>,
  );
  expect(html).toContain("select-none");
  expect(html).toContain("[-webkit-touch-callout:none]");
});

// 端のアイコンで吹き出しが画面の外へ出ると、ページごと横スクロールする
describe("tipAlign", () => {
  test("左端を押したら左へ寄せる", () => {
    expect(tipAlign(20, 390)).toBe("justify-start");
  });

  test("右端を押したら右へ寄せる", () => {
    expect(tipAlign(370, 390)).toBe("justify-end");
  });

  test("真ん中は中央", () => {
    expect(tipAlign(195, 390)).toBe("justify-center");
  });
});
