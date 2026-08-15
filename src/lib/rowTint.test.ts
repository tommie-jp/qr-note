import { describe, expect, test } from "vitest";
import {
  DEFAULT_ROW_TINT_ID,
  isRowTintId,
  parseRowTintId,
  ROW_TINT_ACTIVE_VAR,
  ROW_TINT_BG_VAR,
  ROW_TINT_BORDER_VAR,
  ROW_TINTS,
  rowTintOf,
  rowTintVars,
} from "./rowTint";

// 選択行の色 (docs/88-選択行の色計画.md)。
//
// 確かめたいのは 2 つ: DB / API から来る文字列の畳み方と、globals.css の
// 既定と表がずれていないこと。色の見え方そのものは実機でしか判らない。

describe("parseRowTintId", () => {
  test("既知の色はそのまま通す", () => {
    expect(parseRowTintId("green")).toBe("green");
    expect(parseRowTintId("gray")).toBe("gray");
  });

  test("知らない値・欠落は既定へ寄せる", () => {
    // 手で書き換えた user_settings の行、選択肢を減らした後に残った古い値、
    // まだ 1 度も選んでいない人 (null)。どれも「青で描く」で困らない
    for (const raw of [null, undefined, "", "chartreuse", 3, {}, ["blue"]]) {
      expect(parseRowTintId(raw)).toBe(DEFAULT_ROW_TINT_ID);
    }
  });
});

describe("isRowTintId", () => {
  // API の入口はこちらを使う。既定へ寄せると、送り手は保存できたと思い込む
  test("知らない値は通さない", () => {
    expect(isRowTintId("blue")).toBe(true);
    expect(isRowTintId("chartreuse")).toBe(false);
    expect(isRowTintId(null)).toBe(false);
    expect(isRowTintId(undefined)).toBe(false);
  });
});

describe("ROW_TINTS", () => {
  test("id は重複しない", () => {
    const ids = ROW_TINTS.map((tint) => tint.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("既定の色が表にある", () => {
    expect(isRowTintId(DEFAULT_ROW_TINT_ID)).toBe(true);
  });

  test("どの色も 3 つの値をすべて持つ", () => {
    for (const tint of ROW_TINTS) {
      // 空文字や undefined が混ざると、その用途だけ透明になって
      // 「地色は変わったのに枠だけ消える」形で出る
      expect(tint.bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(tint.active).toMatch(/^#[0-9a-f]{6}$/);
      expect(tint.border).toMatch(/^#[0-9a-f]{6}$/);
      expect(tint.label).not.toBe("");
    }
  });

  test("地色と押下時の色は別 (押した反応が出る)", () => {
    for (const tint of ROW_TINTS) {
      expect(tint.active).not.toBe(tint.bg);
    }
  });
});

describe("rowTintVars", () => {
  test("3 つの変数をすべて立てる", () => {
    expect(rowTintVars("green")).toEqual({
      [ROW_TINT_BG_VAR]: "#f0fdf4",
      [ROW_TINT_ACTIVE_VAR]: "#dcfce7",
      [ROW_TINT_BORDER_VAR]: "#4ade80",
    });
  });

  // globals.css の :root が持つ既定と、この表の blue はずれてはいけない。
  // ずれると「色を選ぶ前」と「青を選んだ後」で違う青になる
  test("既定の色は globals.css の :root と同じ値", () => {
    expect(rowTintVars(DEFAULT_ROW_TINT_ID)).toEqual({
      [ROW_TINT_BG_VAR]: "#eff6ff",
      [ROW_TINT_ACTIVE_VAR]: "#dbeafe",
      [ROW_TINT_BORDER_VAR]: "#60a5fa",
    });
  });
});

describe("rowTintOf", () => {
  test("型の外から来た値でも落ちない", () => {
    // parseRowTintId を通し忘れた経路があっても、既定で描いて通す
    expect(rowTintOf("chartreuse" as never).id).toBe(DEFAULT_ROW_TINT_ID);
  });
});
