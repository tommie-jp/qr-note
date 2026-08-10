import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { buildFenceBlocks, drawableFence } from "./fenceBlocks";

// 図そのものは mermaid が描く (DOM が要るので node では呼ばれない)。
// ここで見るのは「どのフェンスを、いつ畳むか」と「中身の取り出し」。

const MERMAID = "```mermaid\ngraph TD;\n  A-->B;\n```";

function stateWith(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function foldedCount(doc: string, anchor: number, head = anchor): number {
  const set = buildFenceBlocks(stateWith(doc, anchor, head));
  let count = 0;
  const iter = set.iter();
  while (iter.value !== null) {
    count++;
    iter.next();
  }
  return count;
}

describe("drawableFence", () => {
  test("開きと閉じの行を落として中身だけ返す", () => {
    expect(drawableFence(MERMAID)).toEqual({ kind: "mermaid", code: "graph TD;\n  A-->B;" });
  });

  test("circuitikz も対象 (描くのはサーバ)", () => {
    expect(drawableFence("```circuitikz\n\\draw;\n```")).toEqual({
      kind: "circuit",
      code: "\\draw;",
    });
  });

  test("描けない種類のフェンスは対象外", () => {
    expect(drawableFence("```text\nあ\n```")).toBeNull();
    // quiz は React 部品なのでまだ描かない
    expect(drawableFence("```quiz\nQ\n```")).toBeNull();
  });

  test("言語指定の無いフェンスも対象外", () => {
    expect(drawableFence("```\nあ\n```")).toBeNull();
  });

  test("大文字でも読む", () => {
    expect(drawableFence("```Mermaid\ngraph TD;\n```")?.code).toBe("graph TD;");
  });

  test("チルダのフェンスも読む", () => {
    expect(drawableFence("~~~mermaid\ngraph TD;\n~~~")?.code).toBe("graph TD;");
  });

  test("中身が空なら null (描くものが無い)", () => {
    expect(drawableFence("```mermaid\n```")).toBeNull();
  });

  test("閉じの無い書きかけでも中身を返す", () => {
    expect(drawableFence("```mermaid\ngraph TD;")?.code).toBe("graph TD;");
  });
});

describe("buildFenceBlocks", () => {
  test("カーソルが外にあれば図として畳む", () => {
    const doc = `${MERMAID}\n\nあとがき`;
    expect(foldedCount(doc, doc.length)).toBe(1);
  });

  test("カーソルがフェンスの中にあれば畳まない (原文を見せる)", () => {
    expect(foldedCount(MERMAID, 15)).toBe(0);
  });

  test("フェンスの先頭・末尾にカーソルがあれば畳まない", () => {
    expect(foldedCount(MERMAID, 0)).toBe(0);
    expect(foldedCount(MERMAID, MERMAID.length)).toBe(0);
  });

  test("circuitikz も畳む (中身はサーバから受け取る)", () => {
    const doc = "```circuitikz\n\\draw;\n```\n\nあと";
    expect(foldedCount(doc, doc.length)).toBe(1);
  });

  test("描けない種類のフェンスは畳まない", () => {
    // quiz は React 部品なのでまだ描かない (生のフェンスのまま出す)
    const doc = "```quiz\nQ1\n```\n\nあと";
    expect(foldedCount(doc, doc.length)).toBe(0);
  });

  test("普通のコードブロックは畳まない", () => {
    const doc = "```ts\nconst a = 1;\n```\n\nあと";
    expect(foldedCount(doc, doc.length)).toBe(0);
  });

  test("図が 2 つあれば 2 つとも畳む", () => {
    const doc = `${MERMAID}\n\n${MERMAID}\n\nおわり`;
    expect(foldedCount(doc, doc.length)).toBe(2);
  });
});
