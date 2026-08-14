import { describe, expect, test } from "vitest";
import {
  firstPageSource,
  newPageInsertion,
  noteDefinitions,
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

  // 列を空白で揃えた表の罫線。ダッシュだけの行 (`------`) は setext 見出しの
  // 下線になるが、空白を挟んだ行 (`----    ----`) は CommonMark では水平線 —
  // 素通しにすると既存ノートの表が見出しの行と中身で別のページにちぎれる
  test("空白で列を揃えた表の罫線でも分かれない", () => {
    const memo = "点灯    充電中\n----    ----\n消灯    完了\n";
    expect(bodies(memo)).toEqual([memo]);
  });

  // 段落に食い込む線は区切りにしない (上と同じ規則)。空行を挟めば今までどおり
  test("段落に食い込む水平線は区切りにならない", () => {
    expect(splitPages("前\n***\n後")).toHaveLength(1);
    expect(splitPages("前\n\n***\n\n後")).toHaveLength(2);
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

  // 改行が CRLF の本文 (Windows で書いた物の貼り付け・ENEX 取り込み)。
  // 近道の判定 (`$`) は \r の手前でも当たるので remark と読み方が揃う
  test("CRLF の本文でもページが分かれる", () => {
    const memo = "前\r\n\r\n---\r\n\r\n後";
    expect(bodies(memo)).toEqual(["前\r\n\r\n", "\r\n後"]);
    // 開始行は空行を含めて 4 行目 (中身の `後` は 5 行目)
    expect(splitPages(memo)[1].line).toBe(4);
  });
});

// ページごとに描くと、定義 (脚注・参照リンク) と参照が別のページに落ちた
// ときに参照は生の文字・定義は何も描かれない (docs/74 §4)。配る材料を作る側
describe("noteDefinitions", () => {
  test("脚注と参照リンクの定義を原文のまま集める", () => {
    const memo =
      "本文[^1] と [サイト][x]\n\n---\n\n[^1]: 注釈です\n\n[x]: https://example.com\n";
    expect(noteDefinitions(memo)).toBe(
      "[^1]: 注釈です\n\n[x]: https://example.com",
    );
  });

  // 脚注は字下げで続きを書ける。行ではなく mdast の範囲で切るので付いてくる
  test("段落の続きを持つ脚注は字下げの行まで含める", () => {
    const memo = "本文[^1]\n\n[^1]: 一段落目\n\n    二段落目\n";
    expect(noteDefinitions(memo)).toBe("[^1]: 一段落目\n\n    二段落目");
  });

  test("定義が無ければ空文字", () => {
    expect(noteDefinitions("ただのメモ\n\n---\n\nつづき")).toBe("");
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

// 描画と同じプラグイン列で読む (remarkPlugins.ts)。列が欠けていた頃は、
// 同じ本文が画面とページ分割で違う形に読まれていた
describe("描画と同じ解釈にする", () => {
  test("表の直後の区切りでページが割れる (gfm)", () => {
    // gfm 無しでは表がただの段落に見え、`---` が setext 見出しの下線として
    // 吸われて区切りが消えていた
    const memo = "| a | b |\n| --- | --- |\n| 1 | 2 |\n---\nつぎ";
    expect(bodies(memo)).toEqual(["| a | b |\n| --- | --- |\n| 1 | 2 |\n", "つぎ"]);
  });

  test("ブロック数式の中の区切りでは割れない (math)", () => {
    // math 無しでは水平線に見えて数式の途中で割れ、1 ページ目が閉じていない
    // `$$` で終わって以降の本文が消えていた
    const memo = "$$\n\n---\n\n$$\nつぎ";
    expect(bodies(memo)).toEqual([memo]);
  });

  test("折りたたみの中の区切りでは割れない (details)", () => {
    const memo = ":::details[まとめ]\n\n---\n\n:::\nつぎ";
    expect(bodies(memo)).toEqual([memo]);
  });

  test("ふつうの区切りは今までどおり割れる", () => {
    expect(bodies("1ページ\n\n---\n\n2ページ")).toEqual([
      "1ページ\n\n",
      "\n2ページ",
    ]);
  });
});
