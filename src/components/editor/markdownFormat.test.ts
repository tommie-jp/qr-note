import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { formatSpec, type FormatAction } from "./markdownFormat";

// 本文と選択範囲を `|` (カーソル) と `«...»` (選択) で書けるようにする。
// 期待値も同じ書き方で戻すので、選択がどこに残るかまで 1 行で読める。
//
// **`[...]` は使えない** — チェックボックスの記法 (`- [ ] `) と衝突して、
// 本文の角括弧を選択の印と読んでしまう
const SEL_START = "«";
const SEL_END = "»";

function parse(marked: string): EditorState {
  const start = marked.indexOf(SEL_START);
  if (start >= 0) {
    const end = marked.indexOf(SEL_END) - 1;
    return EditorState.create({
      doc: marked.replace(SEL_START, "").replace(SEL_END, ""),
      selection: { anchor: start, head: end },
    });
  }
  const cursor = marked.indexOf("|");
  return EditorState.create({
    doc: marked.replace("|", ""),
    selection: { anchor: cursor },
  });
}

function apply(marked: string, action: FormatAction): string {
  const state = parse(marked);
  const next = state.update(formatSpec(state, action)).state;
  const { from, to } = next.selection.main;
  const doc = next.doc.toString();
  return from === to
    ? `${doc.slice(0, from)}|${doc.slice(from)}`
    : `${doc.slice(0, from)}${SEL_START}${doc.slice(from, to)}${SEL_END}${doc.slice(to)}`;
}

describe("太字", () => {
  test("選択を囲む (選択は中身のまま残る)", () => {
    expect(apply("これは«大事»です", "bold")).toBe("これは**«大事»**です");
  });

  test("記法ごと選んで押すと外れる", () => {
    expect(apply("これは«**大事**»です", "bold")).toBe("これは«大事»です");
  });

  test("記法の内側を選んで押しても外れる", () => {
    // ライブプレビュー中は `**` が隠れているので、利用者が選べるのは中身だけ
    expect(apply("これは**«大事»**です", "bold")).toBe("これは«大事»です");
  });

  test("選択が無ければ記法だけ置いて間にカーソルを入れる", () => {
    expect(apply("これは|です", "bold")).toBe("これは**|**です");
  });
});

describe("インラインコード", () => {
  test("選択を囲む", () => {
    expect(apply("«npm run dev»", "code")).toBe("`«npm run dev»`");
  });

  test("もう一度押すと外れる", () => {
    expect(apply("`«npm run dev»`", "code")).toBe("«npm run dev»");
  });
});

describe("見出し", () => {
  test("無し → # → ## → ### → 無し と巡回する", () => {
    expect(apply("|タイトル", "heading")).toBe("# |タイトル");
    expect(apply("# |タイトル", "heading")).toBe("## |タイトル");
    expect(apply("## |タイトル", "heading")).toBe("### |タイトル");
    expect(apply("### |タイトル", "heading")).toBe("|タイトル");
  });

  test("複数行を選ぶと先頭行の段に揃える", () => {
    // 行ごとに独立して回すと、段の違う行が混ざったときに何が起きるか読めない
    expect(apply("«# あ\nい\n### う»", "heading")).toBe("«## あ\n## い\n## う»");
  });
});

describe("箇条書き・チェックボックス・引用", () => {
  test("行頭に付ける", () => {
    expect(apply("|買い物", "bullet")).toBe("- |買い物");
    expect(apply("|買い物", "task")).toBe("- [ ] |買い物");
    expect(apply("|引用", "quote")).toBe("> |引用");
  });

  test("同じものをもう一度押すと外れる", () => {
    expect(apply("- |買い物", "bullet")).toBe("|買い物");
    expect(apply("- [ ] |買い物", "task")).toBe("|買い物");
    expect(apply("> |引用", "quote")).toBe("|引用");
  });

  test("済みのチェックボックスも外せる", () => {
    // 印の中身は問わない (`[x]` でも「タスクである」と見る)
    expect(apply("- [x] |買い物", "task")).toBe("|買い物");
  });

  test("箇条書きをチェックボックスに置き換える (足さない)", () => {
    expect(apply("- |買い物", "task")).toBe("- [ ] |買い物");
  });

  test("チェックボックスを箇条書きに戻す", () => {
    expect(apply("- [ ] |買い物", "bullet")).toBe("- |買い物");
  });

  test("番号付きも置き換える (`- 1. ` を作らない)", () => {
    expect(apply("1. |買い物", "bullet")).toBe("- |買い物");
  });

  test("字下げは保つ", () => {
    expect(apply("    |入れ子", "bullet")).toBe("    - |入れ子");
  });

  test("選択した全行に付ける", () => {
    expect(apply("«あ\nい»", "bullet")).toBe("«- あ\n- い»");
  });

  test("一部だけ付いている選択は揃える (反転させない)", () => {
    // バラバラのまま反転すると、2 回押しても元に戻らない
    expect(apply("«- あ\nい»", "bullet")).toBe("«- あ\n- い»");
  });

  test("全部付いていれば外す", () => {
    expect(apply("«- あ\n- い»", "bullet")).toBe("«あ\nい»");
  });
});

describe("本文の壊れなさ", () => {
  test("空の本文でも落ちない", () => {
    expect(apply("|", "bullet")).toBe("- |");
    expect(apply("|", "heading")).toBe("# |");
    expect(apply("|", "bold")).toBe("**|**");
  });
});
