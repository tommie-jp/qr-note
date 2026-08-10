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
  test("書式メニューの雛形は見本入りなので「手つかず」ではない", () => {
    // 雛形は見本の文を入れて配るようになったので、そもそも parseQuiz が通り、
    // この見送りに頼らなくても叱られない。ここが true に戻ったら、
    // 雛形が空欄配りに逆戻りした合図
    expect(isUntouchedTemplate(templateBody())).toBe(false);
  });

  test("見本を消して空にしたものは「手つかず」と見る", () => {
    // 打ち直そうとして全部消した途中の状態。まだ書いていないだけなので、
    // そこで赤を出すのは急かしているだけ
    expect(isUntouchedTemplate("問: \n1. \n2. \n正解: 1\n解説: ")).toBe(true);
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
