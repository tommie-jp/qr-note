import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { formatSpec } from "./markdownFormat";
import { isUntouchedTemplate } from "./quizLinter";

// linter 本体は EditorView を要るので node では動かせない (DOM が無い)。
// ここでは「叱るかどうか」を決める判定のうち、**本文だけで決まる部分**を
// 押さえる (カーソル位置による見送りはブラウザで確かめる)。
//
// これを書かなかったせいで、雛形を入れた直後に警告が出る不具合を見落とした
// — ブラウザでも見たが、linter の既定の遅れ (750ms) を待たずに 0 件と
// 読んでしまった。本文で決まることは node で押さえるのが確実。

// 書式メニューが入れる雛形の本文 (フェンスの開き・閉じを除く)
function templateBody(): string {
  const state = EditorState.create({ doc: "", selection: { anchor: 0 } });
  const doc = state.update(formatSpec(state, "quiz")).state.doc.toString();
  const lines = doc.split("\n");
  const open = lines.findIndex((l) => l.startsWith("```quiz"));
  const close = lines.findIndex((l, i) => i > open && l.startsWith("```"));
  return lines.slice(open + 1, close).join("\n");
}

describe("isUntouchedTemplate", () => {
  test("書式メニューで入れたままの雛形は「手つかず」と見る", () => {
    // 骨組みを置いた瞬間に「問: の中身が空です」と出るのは、
    // 入れた瞬間に赤を突きつけるのと同じ
    expect(isUntouchedTemplate(templateBody())).toBe(true);
  });

  test("問を書き始めたら手つかずではない", () => {
    expect(isUntouchedTemplate("問: 1+1 は?\n1. \n2. \n正解: 1\n解説: ")).toBe(
      false,
    );
  });

  test("選択肢を書き始めたら手つかずではない", () => {
    expect(isUntouchedTemplate("問: \n1. 2\n2. \n正解: 1\n解説: ")).toBe(false);
  });

  test("「問:」の行が無いものは手つかず扱いにしない (本物の書き間違い)", () => {
    expect(isUntouchedTemplate("1. あ\n2. い\n正解: 1")).toBe(false);
  });

  test("選択肢の行が無いものも手つかず扱いにしない", () => {
    expect(isUntouchedTemplate("問: \n正解: 1")).toBe(false);
  });

  test("全角のコロン・数字で書いた雛形も手つかずと見る", () => {
    // 日本語入力では「：」「１」が出やすい (quizParse が許している書き方)
    expect(isUntouchedTemplate("問： \n１． \n２． \n正解: 1")).toBe(true);
  });
});
