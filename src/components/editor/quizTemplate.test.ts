import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { formatSpec } from "./markdownFormat";
import { parseQuiz } from "@/lib/quizParse";

// 雛形は「入れた直後に lint が叱らない」ことが要点。
// 骨組みを入れた瞬間に警告が出るなら、それは書式アシストではなく邪魔。

function insertAt(doc: string, anchor: number): { doc: string; cursor: number } {
  const state = EditorState.create({ doc, selection: { anchor } });
  const next = state.update(formatSpec(state, "quiz")).state;
  return { doc: next.doc.toString(), cursor: next.selection.main.from };
}

// フェンスの中身 (開き・閉じの行を除く)
function bodyOf(doc: string): string {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => l.startsWith("```quiz"));
  const end = lines.findIndex((l, i) => i > start && l.startsWith("```"));
  return lines.slice(start + 1, end).join("\n");
}

describe("問題の雛形", () => {
  test("フェンスの形で入る", () => {
    const { doc } = insertAt("", 0);
    expect(doc).toContain("```quiz");
    expect(doc).toContain("問: ");
    expect(doc).toContain("正解: 1");
  });

  test("カーソルは「問:」の直後に来る (そのまま打ち始められる)", () => {
    const { doc, cursor } = insertAt("", 0);
    expect(doc.slice(0, cursor)).toBe("```quiz\n問: ");
  });

  test("行の途中で入れても改行から始める (フェンスは行頭から)", () => {
    const { doc } = insertAt("メモ", "メモ".length);
    expect(doc.startsWith("メモ\n```quiz")).toBe(true);
  });

  test("行頭で入れれば余計な空行を作らない", () => {
    const { doc } = insertAt("メモ\n", "メモ\n".length);
    expect(doc).toBe("メモ\n```quiz\n問: \n1. \n2. \n正解: 1\n解説: \n```\n");
  });

  test("**中身を埋めれば解ける問題になる** (雛形の骨組みが正しい)", () => {
    // 雛形の空欄を埋めただけで parseQuiz が通ることを固定する。
    // 記法が変わって雛形だけ古くなると、書式アシストが間違いを配る
    const { doc } = insertAt("", 0);
    const filled = bodyOf(doc)
      .replace("問: ", "問: 1+1 は?")
      .replace("1. ", "1. 2")
      .replace("2. ", "2. 3")
      .replace("解説: ", "解説: 足し算");
    const parsed = parseQuiz(filled);
    expect("error" in parsed).toBe(false);
  });
});
