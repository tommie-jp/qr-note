import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { blockMathRanges, buildMathBlocks, renderMathHtml } from "./mathBlocks";

// KaTeX の組版そのものは KaTeX の責任。ここで見るのは
// 「どの $...$ を、いつ数式として畳むか」。

function stateWith(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function foldedCount(doc: string, anchor: number, head = anchor): number {
  const set = buildMathBlocks(stateWith(doc, anchor, head));
  let count = 0;
  const iter = set.iter();
  while (iter.value !== null) {
    count++;
    iter.next();
  }
  return count;
}

describe("renderMathHtml", () => {
  test("読める式は HTML になる", () => {
    expect(renderMathHtml("x^2")).toContain("katex");
  });

  test("読めない式は null (書きかけを消さない)", () => {
    // 打っている途中の式は必ず壊れている。例外ではなく null で返す
    expect(renderMathHtml("\\frac{")).toBeNull();
  });
});

describe("buildMathBlocks", () => {
  test("カーソルが外にあれば数式として畳む", () => {
    const doc = "式は $x^2$ です。";
    expect(foldedCount(doc, doc.length)).toBe(1);
  });

  test("カーソルが数式に触れていれば畳まない (原文を見せる)", () => {
    const doc = "式は $x^2$ です。";
    expect(foldedCount(doc, doc.indexOf("$") + 2)).toBe(0);
  });

  test("数式の両端にカーソルがあれば畳まない", () => {
    const doc = "$x^2$";
    expect(foldedCount(doc, 0)).toBe(0);
    expect(foldedCount(doc, doc.length)).toBe(0);
  });

  test("複数の数式をそれぞれ畳む", () => {
    // 末尾に文字を足してからカーソルを置く — 数式の終端にカーソルがあると
    // 「中」と見る規則なので、doc の末尾に置くと最後の 1 つが原文に戻る
    const doc = "$a$ と $b$ と $c$ です";
    expect(foldedCount(doc, doc.length)).toBe(3);
  });

  test("コードフェンスの中の $ は数式にしない", () => {
    // シェルにも正規表現にも $ は出る。拾うと本文が化ける
    const doc = "```bash\necho $HOME か $PATH\n```\n\nあと";
    expect(foldedCount(doc, doc.length)).toBe(0);
  });

  test("インラインコードの中の $ も数式にしない", () => {
    const doc = "`$x^2$` と書く";
    expect(foldedCount(doc, doc.length)).toBe(0);
  });

  test("逃がした $ は区切りにしない", () => {
    // `\$100 と \$200` は通貨。数式ではない
    expect(foldedCount("\\$100 から \\$200 まで", 0)).toBe(0);
  });

  test("読めない式は畳まない (生のまま直せる)", () => {
    const doc = "$\\frac{$ 書きかけ";
    expect(foldedCount(doc, doc.length)).toBe(0);
  });

  test("数式が無ければ何も畳まない", () => {
    expect(foldedCount("ただの本文です。", 0)).toBe(0);
  });
});

describe("blockMathRanges", () => {
  test("1 行で閉じる $$x$$ を取る", () => {
    const found = blockMathRanges("$$x^2$$");
    expect(found).toHaveLength(1);
    expect(found[0].tex).toBe("x^2");
    expect(found[0].display).toBe(true);
  });

  test("行を跨ぐ対を 1 つの範囲にする", () => {
    const doc = "$$\n\\frac{a}{b}\n$$";
    const found = blockMathRanges(doc);
    expect(found).toHaveLength(1);
    expect(found[0].start).toBe(0);
    expect(found[0].end).toBe(doc.length);
    expect(found[0].tex).toBe("\\frac{a}{b}");
  });

  test("開きは行頭の $$ だけ (散文の途中では始めない)", () => {
    // 途中の $$ まで開きにすると、次の $$ までの本文が丸ごと数式にされる
    expect(blockMathRanges("代金は 100$$ で\nその後 200$$ です")).toEqual([]);
  });

  test("閉じないまま終わった対は返さない", () => {
    // 書きかけの $$ で以降の本文が丸ごと消えないように
    expect(blockMathRanges("$$\n\\frac{a}{b}\nつづき")).toEqual([]);
  });

  test("複数のブロックをそれぞれ取る", () => {
    const doc = "$$a$$\n\nあいだ\n\n$$\nb\n$$";
    expect(blockMathRanges(doc)).toHaveLength(2);
  });

  test("$$ が無ければ何も返さない", () => {
    expect(blockMathRanges("ただの本文\n$x^2$ もある")).toEqual([]);
  });
});

describe("ブロック数式の畳み", () => {
  test("カーソルが外にあれば畳む", () => {
    const doc = "$$\nx^2\n$$\n\nあとがき";
    expect(foldedCount(doc, doc.length)).toBe(1);
  });

  test("カーソルが中にあれば畳まない", () => {
    const doc = "$$\nx^2\n$$";
    expect(foldedCount(doc, 4)).toBe(0);
  });

  test("ブロックの中の $ をインライン数式として二重に畳まない", () => {
    // `$$ ... $$` の中身に `$` が現れても、ブロックが取った範囲は除く
    const doc = "$$\na $ b $ c\n$$\n\nあと";
    // 中身が KaTeX で読めないので畳まれない = 装飾は 0。
    // 二重に数えていれば 1 以上になる
    expect(foldedCount(doc, doc.length)).toBe(0);
  });
});
