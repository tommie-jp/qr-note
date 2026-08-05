import type { Element, Root } from "hast";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { createElement } from "react";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { describe, expect, test } from "vitest";
import { rehypeTaskLines, TASK_LINE_PROPERTY } from "./rehypeTaskLines";

// react-markdown に本物のパイプラインを組ませ、rehypeTaskLines の**後ろ**に
// 覗き見用のプラグインを挟んで hast を捕まえる。remark-rehype を自前で
// 呼ばないのは、MarkdownView と同じ経路 (同じ順序・同じサニタイズ) で
// 確かめるため。
function checkboxLines(markdown: string): unknown[] {
  const lines: unknown[] = [];
  const capture = () => (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "input" && node.properties?.type === "checkbox") {
        lines.push(node.properties[TASK_LINE_PROPERTY]);
      }
    });
  };
  renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [remarkGfm],
        // サニタイズ → 刻印 → 覗き見。刻印をサニタイズより前に置くと落ちる
        rehypePlugins: [
          [rehypeSanitize, defaultSchema],
          rehypeTaskLines,
          capture,
        ],
      },
      markdown,
    ),
  );
  return lines;
}

describe("rehypeTaskLines", () => {
  test("チェックボックスに元の行番号を刻む", () => {
    const markdown = ["# 見出し", "", "- [ ] apple", "- [x] banana"].join("\n");
    expect(checkboxLines(markdown)).toEqual([3, 4]);
  });

  test("ゆるいリスト (項目の間に空行) でも刻める", () => {
    // このとき <input> は <li> の直下ではなく <p> の中に入る
    const markdown = ["- [ ] apple", "", "- [ ] banana"].join("\n");
    expect(checkboxLines(markdown)).toEqual([1, 3]);
  });

  test("入れ子のタスクリストは内外それぞれの行番号になる", () => {
    const markdown = ["- [ ] 親", "  - [ ] 子", "- [ ] 弟"].join("\n");
    expect(checkboxLines(markdown)).toEqual([1, 2, 3]);
  });

  test("引用や番号付きリストの中でも刻める", () => {
    const markdown = ["> - [ ] quoted", "", "1. [ ] ordered"].join("\n");
    expect(checkboxLines(markdown)).toEqual([1, 3]);
  });

  test("コードフェンスの中の擬似タスクは <input> にならないので刻まれない", () => {
    const markdown = ["```text", "- [ ] apple", "```", "", "- [ ] real"].join(
      "\n",
    );
    expect(checkboxLines(markdown)).toEqual([5]);
  });

  test("タスクでない箇条書きには <input> が無い", () => {
    expect(checkboxLines("- ただの箇条書き")).toEqual([]);
  });
});
