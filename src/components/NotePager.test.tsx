import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { NotePager, pageIndexFromHash } from "./NotePager";

const render = (names: string[]) =>
  renderToStaticMarkup(
    <NotePager
      pages={names.map((name, i) => ({
        name,
        content: <div>PAGE_{i + 1}</div>,
      }))}
    />,
  );

test("1 ページのノートでは帯を出さない", () => {
  // 「1 / 1」を見せない。区切りを書いていないノートは今までどおりの見た目
  const html = render(["うどん"]);
  expect(html).toContain("PAGE_1");
  expect(html).not.toContain("1 / 1");
  expect(html).not.toContain("次のページ");
});

test("複数ページなら位置とページ名を帯に出す", () => {
  const html = render(["出汁", "具"]);
  expect(html).toContain("1 / 2");
  expect(html).toContain("出汁");
});

// 隠したページも DOM には置く。ブラウザのページ内検索が全ページに効き、
// 印刷では全ページが紙に出る (docs/74-ページ計画.md §4)
test("表示していないページも描く", () => {
  const html = render(["A", "B", "C"]);
  expect(html).toContain("PAGE_1");
  expect(html).toContain("PAGE_2");
  expect(html).toContain("PAGE_3");
});

// hidden 属性で隠すと印刷でも消える (MemoPanel のタブと同じ罠)。
// クラスなら print: で戻せる
test("表示していないページはクラスで隠し、印刷では出す", () => {
  const html = render(["A", "B"]);
  expect(html).toContain("hidden print:block");
  expect(html).not.toContain("<div hidden");
});

test("2 ページ目以降は印刷で改ページする", () => {
  expect(render(["A", "B"])).toContain("print:break-before-page");
});

describe("pageIndexFromHash", () => {
  test("#p3 は 3 ページ目 (0 始まりの 2)", () => {
    expect(pageIndexFromHash("#p3", 5)).toBe(2);
  });

  test("フラグメントが無ければ 1 ページ目", () => {
    expect(pageIndexFromHash("", 5)).toBe(0);
    expect(pageIndexFromHash("#other", 5)).toBe(0);
  });

  // 共有されたリンクの番号が、ページを減らした後の本文に合わないことがある
  test("範囲外の番号は 1 ページ目に丸める", () => {
    expect(pageIndexFromHash("#p9", 5)).toBe(0);
    expect(pageIndexFromHash("#p0", 5)).toBe(0);
  });
});
