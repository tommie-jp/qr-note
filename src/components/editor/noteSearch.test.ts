import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { MAX_TEXT_LENGTH } from "@/lib/validation";
import { secretNotation } from "@/lib/secrets";
import {
  buildQuery,
  countMatches,
  firstMatchFrom,
  planReplaceAll,
  planReplaceCurrent,
  replaceAllNote,
} from "./noteSearch";

// ノート内検索の素の計算 (docs/76-ノート内検索計画.md §8-1)。
// EditorState だけを見る純関数なので、DOM 無しでここまで確かめられる。

const SECRET_NAME = "0123abcd-4567-89ab-cdef-0123456789ab";

function stateWith(doc: string, anchor = 0, head = anchor): EditorState {
  return EditorState.create({ doc, selection: { anchor, head } });
}

describe("buildQuery", () => {
  test("空の検索語は valid にならない (使う側が空打ちを弾かなくてよい)", () => {
    expect(buildQuery("", "", false).valid).toBe(false);
  });

  test("打った文字をそのまま探す (`\\n` を改行に読み替えない)", () => {
    // literal でないと CodeMirror は `\n` を改行として解釈する。
    // コードを書き留めるノートでは、打った 2 文字を探せる方が驚きが少ない
    const query = buildQuery("a\\nb", "", false);
    expect(countMatches(stateWith("a\\nb"), query).total).toBe(1);
    expect(countMatches(stateWith("a\nb"), query).total).toBe(0);
  });
});

describe("countMatches", () => {
  test("本文全体の一致数を返す", () => {
    const state = stateWith("抵抗と抵抗と抵抗");
    expect(countMatches(state, buildQuery("抵抗", "", false)).total).toBe(3);
  });

  test("選択がいまの一致なら何番目かを返す", () => {
    // 「抵抗と抵抗」… 2 つ目は 3..5
    const state = stateWith("抵抗と抵抗", 3, 5);
    expect(countMatches(state, buildQuery("抵抗", "", false))).toEqual({
      total: 2,
      current: 2,
    });
  });

  test("一致の上にいなければ current は 0", () => {
    const state = stateWith("抵抗と抵抗", 2, 2);
    expect(countMatches(state, buildQuery("抵抗", "", false)).current).toBe(0);
  });

  test("既定は大小を区別しない / Aa で区別する", () => {
    const state = stateWith("LED led Led");
    expect(countMatches(state, buildQuery("led", "", false)).total).toBe(3);
    expect(countMatches(state, buildQuery("led", "", true)).total).toBe(1);
  });

  test("空の検索語は 0 件 (打ち始める前にハイライトを出さない)", () => {
    expect(countMatches(stateWith("抵抗"), buildQuery("", "", false))).toEqual({
      total: 0,
      current: 0,
    });
  });
});

describe("firstMatchFrom", () => {
  const query = buildQuery("抵抗", "", false);

  test("指定位置以降の最初の一致を返す", () => {
    expect(firstMatchFrom(stateWith("抵抗と抵抗"), query, 1)).toEqual({
      from: 3,
      to: 5,
    });
  });

  test("後ろに無ければ先頭へ折り返す", () => {
    expect(firstMatchFrom(stateWith("抵抗と定数"), query, 3)).toEqual({
      from: 0,
      to: 2,
    });
  });

  test("1 件も無ければ null", () => {
    expect(firstMatchFrom(stateWith("定数"), query, 0)).toBeNull();
  });
});

describe("planReplaceAll", () => {
  test("すべての一致を置き換える変更を組む", () => {
    const state = stateWith("抵抗と抵抗");
    const plan = planReplaceAll(state, buildQuery("抵抗", "レジスタ", false));
    expect(plan.count).toBe(2);
    expect(plan.changes).toEqual([
      { from: 0, to: 2, insert: "レジスタ" },
      { from: 3, to: 5, insert: "レジスタ" },
    ]);
    expect(plan.skipped).toBe(0);
    expect(plan.tooLong).toBe(false);
  });

  test("シークレット記法に重なる一致は飛ばす (参照が切れると戻せない)", () => {
    const notation = secretNotation("抵抗の在庫", SECRET_NAME);
    const state = stateWith(`抵抗\n${notation}\n抵抗`);
    const plan = planReplaceAll(state, buildQuery("抵抗", "レジスタ", false));
    expect(plan.count).toBe(2);
    expect(plan.skipped).toBe(1);
    // 記法の中 (ラベルの「抵抗」) には触らない。本文の前後 2 つだけを直す
    expect(plan.changes.map((change) => change.from)).toEqual([
      0,
      3 + notation.length + 1,
    ]);
  });

  test("上限を超えるなら何も変えない (changeFilter に黙って捨てられる)", () => {
    // 1 文字を 3 文字にすると上限を超える長さの本文
    const doc = "あ".repeat(MAX_TEXT_LENGTH - 10);
    const plan = planReplaceAll(stateWith(doc), buildQuery("あ", "ABC", false));
    expect(plan.tooLong).toBe(true);
    expect(plan.changes).toEqual([]);
  });

  test("縮む置換は上限を超えない", () => {
    const doc = "あい".repeat(100);
    const plan = planReplaceAll(stateWith(doc), buildQuery("あい", "あ", false));
    expect(plan.tooLong).toBe(false);
    expect(plan.count).toBe(100);
  });

  test("検索語が空なら何も組まない", () => {
    const plan = planReplaceAll(stateWith("抵抗"), buildQuery("", "x", false));
    expect(plan.count).toBe(0);
    expect(plan.changes).toEqual([]);
  });
});

describe("replaceAllNote", () => {
  const plan = {
    changes: [],
    count: 3,
    skipped: 0,
    tooLong: false,
  };

  test("件数を言い、元に戻す道を添える", () => {
    expect(replaceAllNote(plan)).toEqual({
      text: "3 件置換しました",
      undo: true,
    });
  });

  test("飛ばしたシークレットは必ず言う (黙ると壊れて見える)", () => {
    expect(replaceAllNote({ ...plan, skipped: 1 }).text).toBe(
      "3 件置換しました (シークレット 1 件は対象外)",
    );
  });

  test("上限超えは断りだけ (戻す物が無いので undo は添えない)", () => {
    const note = replaceAllNote({ ...plan, count: 0, tooLong: true });
    expect(note.undo).toBe(false);
    expect(note.text).toContain("32,000");
  });

  test("シークレットの中しか無かったときは、そう言う", () => {
    const note = replaceAllNote({ ...plan, count: 0, skipped: 2 });
    expect(note).toEqual({
      text: "置換できる一致がありません (シークレット 2 件は対象外)",
      undo: false,
    });
  });
});

describe("planReplaceCurrent", () => {
  const query = buildQuery("抵抗", "レジスタ", false);

  test("選択がいまの一致ならその 1 件を置き換える", () => {
    const plan = planReplaceCurrent(stateWith("抵抗と抵抗", 3, 5), query);
    expect(plan.change).toEqual({ from: 3, to: 5, insert: "レジスタ" });
    expect(plan.tooLong).toBe(false);
  });

  test("一致の上にいなければ何も置き換えない (次へ進むだけ)", () => {
    expect(planReplaceCurrent(stateWith("抵抗と抵抗", 0, 0), query).change).toBeNull();
  });

  test("上限を超えるなら置き換えない", () => {
    const doc = `抵抗${"あ".repeat(MAX_TEXT_LENGTH - 2)}`;
    const plan = planReplaceCurrent(stateWith(doc, 0, 2), query);
    expect(plan.tooLong).toBe(true);
    expect(plan.change).toBeNull();
  });
});
