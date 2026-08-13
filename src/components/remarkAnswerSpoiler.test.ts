import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { describe, expect, test } from "vitest";
import { unified } from "unified";
import { remarkAnswerSpoiler } from "./remarkAnswerSpoiler";
import { ANSWER_SPOILER_CLASS } from "@/lib/answerSpoiler";

function run(markdown: string, mask = false): Root {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
  remarkAnswerSpoiler({ mask })(tree);
  return tree;
}

// 木の中の「答え」ノード (span に化ける emphasis) を集める
function spoilers(tree: Root): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) {
      return;
    }
    const n = node as {
      type?: string;
      value?: string;
      data?: { hProperties?: { className?: string[] } };
      children?: unknown[];
    };
    if (n.data?.hProperties?.className?.includes(ANSWER_SPOILER_CLASS)) {
      found.push(
        (n.children ?? [])
          .map((c) => (c as { value?: string }).value ?? "")
          .join(""),
      );
    }
    (n.children ?? []).forEach(walk);
  };
  walk(tree);
  return found;
}

// 木に残っている素のテキストを繋げたもの
function text(tree: Root): string {
  let out = "";
  const walk = (node: unknown): void => {
    const n = node as { type?: string; value?: string; children?: unknown[] };
    if (n.type === "text" || n.type === "inlineCode") {
      out += n.value ?? "";
    }
    (n.children ?? []).forEach(walk);
  };
  walk(tree);
  return out;
}

describe("remarkAnswerSpoiler", () => {
  test("`||答え||` を答えノードに変える", () => {
    const tree = run("- [ ] infect ||動 ～に感染させる||");
    expect(spoilers(tree)).toEqual(["動 ～に感染させる"]);
    // 記法の `||` は残らない (答えの文字は答えノードの中にある)
    expect(text(tree)).not.toContain("||");
  });

  test("1 行に複数あっても変える", () => {
    expect(spoilers(run("a ||1|| b ||2||"))).toEqual(["1", "2"]);
  });

  // GFM の表では `||` が空セルを意味する。記法にすると書いた表が壊れる
  test("表のセルの中は変えない", () => {
    const tree = run("| a || b |\n| --- | --- | --- |\n| 1 | 2 | 3 |");
    expect(spoilers(tree)).toEqual([]);
  });

  // <a> の中に <button> は不正な入れ子になる
  test("リンクの中は変えない", () => {
    const tree = run("[見出し ||訳||](https://example.com)");
    expect(spoilers(tree)).toEqual([]);
  });

  test("インラインコードの中は変えない", () => {
    const tree = run("`||訳||`");
    expect(spoilers(tree)).toEqual([]);
    expect(text(tree)).toBe("||訳||");
  });

  test("コードフェンスの中は変えない", () => {
    const tree = run("```text\n||訳||\n```");
    expect(spoilers(tree)).toEqual([]);
  });

  test("強調の中でも変える (テキストノードとして届くので)", () => {
    expect(spoilers(run("**infect ||訳||**"))).toEqual(["訳"]);
  });

  test("閉じていない `||` は文字のまま残す", () => {
    const tree = run("infect ||訳");
    expect(spoilers(tree)).toEqual([]);
    expect(text(tree)).toBe("infect ||訳");
  });

  test("記法が無い本文は何も変えない", () => {
    const tree = run("- [ ] infect");
    expect(spoilers(tree)).toEqual([]);
    expect(text(tree)).toBe("infect");
  });

  // 一覧のプレビュー用。押せる部品を置かず、答えも出さない
  test("mask では ▶ の文字に置き換える", () => {
    const tree = run("infect ||訳||", true);
    expect(spoilers(tree)).toEqual([]);
    expect(text(tree)).toBe("infect ▶");
  });
});
