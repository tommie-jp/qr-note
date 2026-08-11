import { describe, expect, test } from "vitest";
import {
  firstPageSource,
  newPageInsertion,
  pageIndexAt,
  splitPages,
} from "./notePages";

const bodies = (memo: string) => splitPages(memo).map((page) => page.body);

// 挿入を実際に本文へ当てた結果 (呼ぶ側がやることの再現)
const applyInsertion = (memo: string, offset: number) => {
  const { from, to, insert } = newPageInsertion(memo, offset);
  return memo.slice(0, from) + insert + memo.slice(to);
};

describe("splitPages", () => {
  test("水平線が無ければノート全体が 1 ページ", () => {
    const memo = "うどん 関西\n#鍋\n\n水 500cc\n";
    const pages = splitPages(memo);
    expect(pages).toHaveLength(1);
    expect(pages[0].body).toBe(memo);
    expect(pages[0].name).toBe("うどん 関西");
  });

  test("空行を挟んだ水平線でページが分かれる", () => {
    expect(bodies("前\n\n---\n\n後\n")).toEqual(["前\n\n", "\n後\n"]);
  });

  // ローカルの写しで `---` を含む 11 件のうち 10 件がこの形 (表の罫線)。
  // CommonMark では段落の直後の `---` は setext 見出しの下線なので、
  // 自前の正規表現ではなく remark に判定させることでページが割れない
  test("段落の直後の罫線 (setext 見出し) では分かれない", () => {
    const memo = "赤LED\n------\n点灯    充電中\n消灯    完了\n";
    expect(splitPages(memo)).toHaveLength(1);
  });

  test("コードフェンスの中の水平線では分かれない", () => {
    expect(splitPages("```text\n\n---\n\n```\n")).toHaveLength(1);
  });

  test("折りたたみの中の水平線では分かれない", () => {
    const memo = ":::details[長いログ]\n\n前\n\n---\n\n後\n\n:::\n";
    expect(splitPages(memo)).toHaveLength(1);
  });

  test("引用・リストの中の水平線では分かれない", () => {
    expect(splitPages("> 前\n>\n> ---\n>\n> 後\n")).toHaveLength(1);
    expect(splitPages("- 項目\n\n  ---\n\n  続き\n")).toHaveLength(1);
  });

  test("`***` と `___` も水平線として分かれる", () => {
    expect(bodies("前\n\n***\n\n後")).toEqual(["前\n\n", "\n後"]);
    expect(bodies("前\n\n___\n\n後")).toEqual(["前\n\n", "\n後"]);
  });

  // ＋ を押した直後は「末尾に空のページがある」状態そのもの。
  // 空を捨てると、押しても何も増えていないように見える
  test("先頭・末尾の水平線が空ページを残す", () => {
    expect(bodies("---\n\n本文")).toEqual(["", "\n本文"]);
    expect(bodies("本文\n\n---\n")).toEqual(["本文\n\n", ""]);
  });

  test("連続した水平線が間に空ページを残す", () => {
    expect(bodies("A\n\n---\n\n---\n\nB")).toEqual(["A\n\n", "\n", "\nB"]);
  });

  test("body は memo の切れ端そのもの (start + body = end)", () => {
    const memo = "A\n\n---\n\nB\n\n---\n\nC";
    for (const page of splitPages(memo)) {
      expect(memo.slice(page.start, page.end)).toBe(page.body);
      expect(page.start + page.body.length).toBe(page.end);
    }
  });

  // チェックボックスの行番号は本文全体に対する番号 (docs/55)。ページを
  // 別々に描いても押した行がずれないよう、ページの開始行を持つ
  test("ページの開始行 (1 始まり) を持つ", () => {
    const memo = "A\n\n---\n\n- [ ] やること";
    expect(splitPages(memo).map((page) => page.line)).toEqual([1, 4]);
    // 2 ページ目の 2 行目 = 本文の 5 行目
    expect(memo.split("\n")[4]).toBe("- [ ] やること");
  });

  test("ページ名はそのページの先頭行から作る (memoSummary と同じ規則)", () => {
    const memo = "# 出汁\n\n昆布\n\n---\n\n## 具\n\n油揚げ";
    expect(splitPages(memo).map((page) => page.name)).toEqual(["出汁", "具"]);
  });

  test("中身の無いページの名前は空文字", () => {
    expect(splitPages("A\n\n---\n\n").map((page) => page.name)).toEqual([
      "A",
      "",
    ]);
  });

  test("空のノートは 1 ページ", () => {
    expect(bodies("")).toEqual([""]);
  });

  // 水平線になりうる行が無ければ remark を通さない近道を通る。
  // 近道でも普通の道でも同じ形が返ることを押さえる
  test("近道 (水平線なし) でもページの形は同じ", () => {
    const memo = "ただのメモ #タグ\n本文";
    expect(splitPages(memo)).toEqual([
      { name: "ただのメモ #タグ", body: memo, start: 0, end: memo.length, line: 1 },
    ]);
  });

  // 近道の判定は本物の規則より広く拾う。空白入りの `- - -` も水平線
  test("空白を挟んだ `- - -` も水平線として分かれる", () => {
    expect(splitPages("前\n\n- - -\n\n後")).toHaveLength(2);
  });
});

describe("pageIndexAt", () => {
  const memo = "A\n\n---\n\nB";
  const pages = splitPages(memo);

  test("ページの中の位置はそのページ", () => {
    expect(pageIndexAt(pages, 0)).toBe(0);
    expect(pageIndexAt(pages, memo.length)).toBe(1);
  });

  // 区切り行の上はひとつ前のページの終わり際として扱う。＋ の挿入位置が
  // カーソルの目の前になるほうが、押した結果を予想しやすい
  test("区切り行の上はひとつ前のページ", () => {
    expect(pageIndexAt(pages, 4)).toBe(0);
  });
});

describe("newPageInsertion", () => {
  test("今いるページの直後に区切りを足す", () => {
    expect(applyInsertion("A\n\n---\n\nB", 0)).toBe("A\n\n---\n\n---\n\nB");
  });

  test("末尾の空白を畳んでから足す", () => {
    expect(applyInsertion("A\n\n\n", 0)).toBe("A\n\n---\n\n");
  });

  test("空のノートでは先頭に区切りだけを置く", () => {
    expect(applyInsertion("", 0)).toBe("---\n\n");
  });

  test("カーソルは新しいページの先頭に来る", () => {
    const memo = "A\n\n---\n\nB";
    const { cursor } = newPageInsertion(memo, memo.length);
    expect(applyInsertion(memo, memo.length)).toBe("A\n\n---\n\nB\n\n---\n\n");
    expect(cursor).toBe("A\n\n---\n\nB\n\n---\n\n".length);
  });

  test("足したページは splitPages で 1 ページ増える", () => {
    const memo = "A\n\n---\n\nB";
    expect(splitPages(applyInsertion(memo, 0))).toHaveLength(3);
  });
});

describe("firstPageSource", () => {
  test("1 ページ目だけを返す", () => {
    expect(firstPageSource("A\n\n---\n\nB")).toBe("A\n\n");
  });

  // 一覧のタイトル (memoSummary) が 2 ページ目の見出しを拾うので、
  // その下のプレビューも同じページを見せる
  test("1 ページ目が空なら中身のある最初のページを返す", () => {
    expect(firstPageSource("---\n\nB")).toBe("\nB");
  });

  test("どのページにも中身が無ければ空文字", () => {
    expect(firstPageSource("---\n\n---")).toBe("");
  });
});
