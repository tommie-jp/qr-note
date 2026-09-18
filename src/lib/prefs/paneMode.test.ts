import { describe, expect, test } from "vitest";
import {
  DEFAULT_PANE_MODE,
  keepsNoteOpen,
  nextPaneMode,
  notePaneLayout,
  parsePaneMode,
  showsAutoNote,
  showsFolderPane,
} from "./paneMode";

describe("parsePaneMode", () => {
  test("3 / 2 / 1 はそのまま", () => {
    expect(parsePaneMode("3")).toBe("3");
    expect(parsePaneMode("2")).toBe("2");
    expect(parsePaneMode("1")).toBe("1");
  });

  test("cookie は外部入力なので知らない値は既定に畳む", () => {
    expect(parsePaneMode("0")).toBe(DEFAULT_PANE_MODE);
    expect(parsePaneMode(3)).toBe(DEFAULT_PANE_MODE);
    expect(parsePaneMode(undefined)).toBe(DEFAULT_PANE_MODE);
    expect(parsePaneMode("../etc")).toBe(DEFAULT_PANE_MODE);
  });
});

test("押すたびに 3 → 2 → 1 → 3 と回る", () => {
  expect(nextPaneMode("3")).toBe("2");
  expect(nextPaneMode("2")).toBe("1");
  expect(nextPaneMode("1")).toBe("3");
});

test("フォルダーを出すのは 3 のときだけ", () => {
  expect(showsFolderPane("3")).toBe(true);
  expect(showsFolderPane("2")).toBe(false);
  expect(showsFolderPane("1")).toBe(false);
});

// ノートのペインを持つ構成 (3 / 2) は出しっぱなし。1 は全画面なので閉じる
test("ノートを閉じずに出し続けるのはペインを持つ構成 (3 / 2)", () => {
  expect(keepsNoteOpen("3")).toBe(true);
  expect(keepsNoteOpen("2")).toBe(true);
  expect(keepsNoteOpen("1")).toBe(false);
});

// 何も選んでいないときに先頭を出すのも同じ 2 つ
test("先頭を自動で選ぶのもペインを持つ構成 (3 / 2)", () => {
  expect(showsAutoNote("3")).toBe(true);
  expect(showsAutoNote("2")).toBe(true);
  expect(showsAutoNote("1")).toBe(false);
});

// 幅では畳まない (docs/86 §4-16)。2 ペインは以前 lg 未満で全画面になり、
// スマホで検索結果とノートを並べられなかった
test("ノートの器は 3 / 2 が下部のペイン、1 が全画面", () => {
  expect(notePaneLayout("3")).toBe("pane");
  expect(notePaneLayout("2")).toBe("pane");
  expect(notePaneLayout("1")).toBe("fullscreen");
});
