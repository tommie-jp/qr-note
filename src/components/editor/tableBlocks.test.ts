import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { buildTableBlocks } from "./tableBlocks";

// 表を「いつ畳んで、いつ原文に戻すか」だけを見る (widget の中身は
// markdownTable.test.ts が持つ。DOM は node に無いので toDOM は呼ばれない)。

const TABLE = "| 名前 | 数量 |\n| --- | ---: |\n| りんご | 3 |";

// MemoEditorInner と同じ設定 (GFM。既定の CommonMark では Table が出ない)
function stateWith(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function foldedCount(doc: string, anchor: number, head = anchor): number {
  const set = buildTableBlocks(stateWith(doc, anchor, head));
  let count = 0;
  const iter = set.iter();
  while (iter.value !== null) {
    count++;
    iter.next();
  }
  return count;
}

describe("buildTableBlocks", () => {
  test("カーソルが外にあれば表として畳む", () => {
    const doc = `${TABLE}\n\nあとがき`;
    expect(foldedCount(doc, doc.length)).toBe(1);
  });

  test("カーソルが表の中にあれば畳まない (原文を見せる)", () => {
    // 直せないと困るので、触れている間は必ず原文
    expect(foldedCount(TABLE, 5)).toBe(0);
  });

  test("表の先頭・末尾にカーソルがあれば畳まない (次に打つ文字が表に入る)", () => {
    expect(foldedCount(TABLE, 0)).toBe(0);
    expect(foldedCount(TABLE, TABLE.length)).toBe(0);
  });

  test("表を跨ぐ選択でも畳まない", () => {
    const doc = `まえがき\n${TABLE}\nあとがき`;
    expect(foldedCount(doc, 0, doc.length)).toBe(0);
  });

  test("隣を選んだだけなら畳んだまま (端が接するのは「触れていない」)", () => {
    // 選択のたびに表が原文へ戻ると画面が跳ねる。
    // **空行で表を閉じる** — GFM の表は空行が来るまで続くので、詰めて書くと
    // 次の段落まで表の一部として読まれる
    const doc = `${TABLE}\n\nあとがき`;
    const tail = doc.indexOf("あとがき");
    expect(foldedCount(doc, tail, doc.length)).toBe(1);
  });

  test("表が 2 つあれば 2 つとも畳む", () => {
    const doc = `${TABLE}\n\n${TABLE}\n\nおわり`;
    expect(foldedCount(doc, doc.length)).toBe(2);
  });

  test("表が無ければ何も畳まない", () => {
    expect(foldedCount("ただの本文\n# 見出し", 0)).toBe(0);
  });

  test("コードフェンスの中の表は畳まない", () => {
    // 構文木に聞いているのでフェンスの中は Table にならない
    const doc = "```text\n| a |\n| - |\n| 1 |\n```";
    expect(foldedCount(doc, doc.length)).toBe(0);
  });
});
