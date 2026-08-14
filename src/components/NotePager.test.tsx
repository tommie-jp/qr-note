import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  anchorPageIndex,
  NotePager,
  pageFrameClass,
  pageIndexFromHash,
} from "./NotePager";

// サーバ描画では設定 (localStorage) を読みようがないので、必ず既定 =
// ページ送りありで描かれる (lib/notePagerPref.ts の useNotePagerPaged)
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

// 前後は文字ではなくアイコン (docs/82-ノート操作アイコン計画.md §4)。
// 文字を消したぶん、名前は読み上げと長押しの吹き出しに残す
test("前後のボタンはアイコンで、名前は aria-label に残る", () => {
  const html = render(["A", "B"]);
  expect(html).toContain('aria-label="前のページ"');
  expect(html).toContain('aria-label="次のページ"');
  // ボタンの中身は svg だけ (文字は出さない)
  expect(html).not.toContain(">次のページ<");
});

// 枠の着せ替え。通し表示 (docs/82 §3) では 1 枚も隠さず、全ページが続けて出る
describe("pageFrameClass", () => {
  test("ページ送り中は開いていないページを隠す", () => {
    expect(pageFrameClass(true, 1, 0)).toContain("hidden print:block");
    expect(pageFrameClass(true, 0, 0)).not.toContain("hidden");
  });

  test("通し表示では 1 枚も隠さない", () => {
    expect(pageFrameClass(false, 1, 0)).not.toContain("hidden");
    expect(pageFrameClass(false, 2, 0)).not.toContain("hidden");
  });

  // 通し表示で `#p3` から送られてきたときに、sticky なヘッダーの下へ
  // 潜らせない (帯と同じ値)
  test("枠は sticky ヘッダーぶん手前で止まる", () => {
    expect(pageFrameClass(false, 2, 0)).toContain("scroll-mt-12");
  });

  // 隠していても紙には出す。画面のページと紙のページを一致させる
  test("2 ページ目以降はどちらの表示でも改ページする", () => {
    expect(pageFrameClass(true, 1, 1)).toContain("print:break-before-page");
    expect(pageFrameClass(false, 1, 0)).toContain("print:break-before-page");
    expect(pageFrameClass(false, 0, 0)).not.toContain("break-before");
  });
});

describe("pageIndexFromHash", () => {
  test("#p3 は 3 ページ目 (0 始まりの 2)", () => {
    expect(pageIndexFromHash("#p3", 5)).toBe(2);
  });

  // #pN 以外は「ページの指定ではない」印の null。1 ページ目に丸めていた頃は、
  // 脚注の番号や「本文に戻る」を押すたびに読んでいたページから引き戻され、
  // 飛び先が隠れたページの中に入って何も起きなかった
  test("#pN 以外のフラグメントではページを変えない", () => {
    expect(pageIndexFromHash("#user-content-fn-1", 5)).toBeNull();
    expect(pageIndexFromHash("#other", 5)).toBeNull();
    expect(pageIndexFromHash("", 5)).toBeNull();
  });

  // 共有されたリンクの番号が、ページを減らした後の本文に合わないことがある
  test("範囲外の番号は 1 ページ目に丸める", () => {
    expect(pageIndexFromHash("#p9", 5)).toBe(0);
    expect(pageIndexFromHash("#p0", 5)).toBe(0);
  });
});

// アンカーの飛び先が居るページ (真偽の並びは「この枠に飛び先があるか」)。
// 脚注の定義は全ページに配ってあるので (NoteBody)、同じ id が何ページにも居る
describe("anchorPageIndex", () => {
  test("開いているページに飛び先があればそのページのまま", () => {
    expect(anchorPageIndex([true, false, true], 2)).toBe(2);
  });

  test("別のページに飛び先があればそのページへ送る", () => {
    expect(anchorPageIndex([false, true, false], 0)).toBe(1);
  });

  test("どのページにも無ければ null (ページを変えない)", () => {
    expect(anchorPageIndex([false, false], 1)).toBeNull();
  });
});
