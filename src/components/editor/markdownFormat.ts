// 書式メニューの中身 — 選択範囲に markdown の記法を付け外しする
// (docs/70-編集ライブプレビュー計画.md §6)。
//
// スマホで「markdown を簡単に編集したい」の実利は、記法を隠すこと
// (ライブプレビュー) よりむしろ**記法を打たずに済むこと**にある。`#` や
// `**` はソフトキーボードでは記号面に切り替えないと打てない。
//
// ここは EditorState を読んで TransactionSpec を返すだけの層で、view も DOM も
// 触らない (vitest が node 環境のため)。dispatch と focus は呼ぶ側が行う。

import type { EditorState, TransactionSpec } from "@codemirror/state";

export type FormatAction =
  | "bold"
  | "code"
  | "heading"
  | "bullet"
  | "task"
  | "quote";

// 囲む記法。**斜体 (`*`) は入れていない** — 太字 `**` と前後が重なり、
// 「`**太字**` に斜体を掛ける」が「星を 1 つずつ剥がして太字を解く」と
// 見分けられなくなる。斜体はスマホで書く頻度も低い
const WRAP_MARKER: Record<"bold" | "code", string> = {
  bold: "**",
  code: "`",
};

// 行頭に付ける記法。**互いに排他**にしてある — 箇条書きの行で
// チェックボックスを押したら `- ` を `- [ ] ` に**置き換える**(足さない)。
// `> - item` のような入れ子は手で書けばよく、メニューで作れる必要はない
const LINE_PREFIX: Record<"bullet" | "task" | "quote", string> = {
  bullet: "- ",
  task: "- [ ] ",
  quote: "> ",
};

// 行頭に既に付いている記法。付け替えのために「今どれか」を知る必要がある。
// 番号付き (`1. `) も含めるのは、箇条書きを押したときに `- ` へ**置き換える**
// ため (含めないと `- 1. foo` になる)
const EXISTING_PREFIX_RE = /^(?:- \[[ xX]\] |[-*+] |> |\d{1,9}[.)] )/;

// 見出しは行頭記法だが、上の付け替えの輪には入れない (見出しの箇条書きは
// 無いが、見出しを引用に入れることはある)。`# ` の後の空白まで含めて数える
const HEADING_RE = /^(#{1,6}) /;

// 見出しの巡回: 無し → # → ## → ### → 無し。h4 以降まで回さないのは、
// 押し続けて戻ってくるまでが遠くなるため (h4 以下は手で書ける)
const MAX_CYCLED_HEADING_LEVEL = 3;

// 行頭の字下げを保ったまま記法を差し替えるため、3 つに割る
interface SplitLine {
  indent: string;
  prefix: string;
  rest: string;
}

function splitLine(text: string): SplitLine {
  const indent = /^[ \t]*/.exec(text)?.[0] ?? "";
  const afterIndent = text.slice(indent.length);
  const prefix = EXISTING_PREFIX_RE.exec(afterIndent)?.[0] ?? "";
  return { indent, prefix, rest: afterIndent.slice(prefix.length) };
}

// 選択範囲が跨ぐ行の番号 (1 始まり)。選択が無ければカーソルのある 1 行
function selectedLineNumbers(state: EditorState): number[] {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  const numbers: number[] = [];
  for (let n = first; n <= last; n++) {
    numbers.push(n);
  }
  return numbers;
}

// 行頭の記法を差し替えたあと、選択とカーソルをどこへ置くか。
//
// **カーソルと選択で寄せ方を変える**のが要点。
//   - カーソル (選択なし) … 記法の**後ろ**へ送る。行頭で押したときに
//     カーソルが `- ` の手前に取り残されると、続けて打った文字が記法の
//     外に出てしまう。
//   - 選択あり … 始まりは記法の**手前**に残す。後ろへ送ると、選んだ行の
//     1 行目だけ記法が選択から外れ、続けて別の記法を掛けられなくなる。
function keepSelection(
  state: EditorState,
  changes: { from: number; to: number; insert: string }[],
) {
  const changeSet = state.changes(changes);
  const { from, to, empty } = state.selection.main;
  return empty
    ? { anchor: changeSet.mapPos(from, 1) }
    : { anchor: changeSet.mapPos(from, -1), head: changeSet.mapPos(to, 1) };
}

// 行頭記法の付け外し。**全部が既にその記法なら外す、そうでなければ揃える** —
// 一部だけ付いた選択で押したときに「揃う」ほうが期待に近い
// (バラバラのまま反転すると、2 回押しても元に戻らない)
function toggleLinePrefix(
  state: EditorState,
  action: "bullet" | "task" | "quote",
): TransactionSpec {
  const marker = LINE_PREFIX[action];
  const lines = selectedLineNumbers(state).map((n) => state.doc.line(n));
  // チェックボックスは印の中身 (`[ ]` / `[x]`) を問わず「タスクである」と見る。
  // 済みの項目でもう一度押したら、外れてほしい
  const isSame = (prefix: string) =>
    action === "task" ? /^- \[[ xX]\] $/.test(prefix) : prefix === marker;
  const removing = lines.every((line) => isSame(splitLine(line.text).prefix));

  const changes = lines.map((line) => {
    const { indent, prefix } = splitLine(line.text);
    const at = line.from + indent.length;
    return {
      from: at,
      to: at + prefix.length,
      insert: removing ? "" : marker,
    };
  });
  return { changes, selection: keepSelection(state, changes) };
}

// 見出しの巡回。**選択の先頭行の段を見て、選択した全行を同じ段に揃える** —
// 行ごとに独立して回すと、段の違う行を選んだときに何が起きるか読めない
function cycleHeading(state: EditorState): TransactionSpec {
  const lines = selectedLineNumbers(state).map((n) => state.doc.line(n));
  const headingOf = (text: string) =>
    (HEADING_RE.exec(text)?.[1] ?? "").length;
  const current = headingOf(lines[0].text);
  const next = current >= MAX_CYCLED_HEADING_LEVEL ? 0 : current + 1;
  const marker = next === 0 ? "" : `${"#".repeat(next)} `;

  const changes = lines.map((line) => {
    const indent = /^[ \t]*/.exec(line.text)?.[0] ?? "";
    const at = line.from + indent.length;
    const existing = HEADING_RE.exec(line.text.slice(indent.length))?.[0] ?? "";
    return { from: at, to: at + existing.length, insert: marker };
  });
  return { changes, selection: keepSelection(state, changes) };
}

// 囲む記法の付け外し。見るのは選択範囲 1 つだけ (スマホの操作は 1 か所)
function toggleWrap(state: EditorState, marker: string): TransactionSpec {
  const { from, to } = state.selection.main;
  const width = marker.length;

  // 選択が無ければ記法だけ置いて、間にカーソルを入れる (続けて打てる)
  if (from === to) {
    return {
      changes: { from, insert: marker + marker },
      selection: { anchor: from + width },
    };
  }

  const selected = state.doc.sliceString(from, to);
  // 記法ごと選んでいる場合 (`**太字**` を選んで押した)
  if (
    selected.length >= width * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    return {
      changes: [
        { from, to: from + width },
        { from: to - width, to },
      ],
      selection: { anchor: from, head: to - width * 2 },
    };
  }

  // 記法の内側だけを選んでいる場合 (`**太字**` の 太字 を選んで押した)
  const before = state.doc.sliceString(Math.max(0, from - width), from);
  const after = state.doc.sliceString(to, Math.min(state.doc.length, to + width));
  if (before === marker && after === marker) {
    return {
      changes: [
        { from: from - width, to: from },
        { from: to, to: to + width },
      ],
      selection: { anchor: from - width, head: to - width },
    };
  }

  // 付ける。選択は中身のまま残す (続けて別の記法も掛けられる)
  return {
    changes: [
      { from, insert: marker },
      { from: to, insert: marker },
    ],
    selection: { anchor: from + width, head: to + width },
  };
}

// 書式メニューの 1 項目ぶんの操作を、本文への変更に変える。
// 呼ぶ側は返ってきたものを dispatch するだけでよい
export function formatSpec(
  state: EditorState,
  action: FormatAction,
): TransactionSpec {
  switch (action) {
    case "bold":
    case "code":
      return toggleWrap(state, WRAP_MARKER[action]);
    case "heading":
      return cycleHeading(state);
    default:
      return toggleLinePrefix(state, action);
  }
}
