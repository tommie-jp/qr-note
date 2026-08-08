import { expect, test } from "vitest";
import {
  DEFAULT_NOTE_FONT_SCALE,
  NOTE_FONT_SCALE_INIT_SCRIPT,
  NOTE_FONT_SCALE_KEY,
  NOTE_FONT_SCALE_VAR,
  NOTE_FONT_SCALES,
  noteFontScaleLabel,
  normalizeNoteFontScale,
  stepNoteFontScale,
} from "./noteFontScale";

test("保存されていなければ等倍にする", () => {
  expect(normalizeNoteFontScale(null)).toBe(DEFAULT_NOTE_FONT_SCALE);
  expect(normalizeNoteFontScale(undefined)).toBe(DEFAULT_NOTE_FONT_SCALE);
});

test("保存された段の値をそのまま読む", () => {
  expect(normalizeNoteFontScale("1.3")).toBe(1.3);
});

// localStorage は誰でも書ける。数でない文字や桁外れの値が来ても
// 本文が読めない大きさになってはいけない
test("数でない値は等倍に倒す", () => {
  expect(normalizeNoteFontScale("abc")).toBe(DEFAULT_NOTE_FONT_SCALE);
  expect(normalizeNoteFontScale("")).toBe(DEFAULT_NOTE_FONT_SCALE);
  expect(normalizeNoteFontScale("NaN")).toBe(DEFAULT_NOTE_FONT_SCALE);
});

// 段を後から増減しても、古い端末に残った値が捨てられない (いちばん近い段に寄る)
test("段にない値はいちばん近い段に寄せる", () => {
  expect(normalizeNoteFontScale("1.2")).toBe(1.15);
  expect(normalizeNoteFontScale("99")).toBe(2);
  expect(normalizeNoteFontScale("-5")).toBe(0.75);
  // 旧仕様 (下限 100%) の頃には無かった値も近い段に拾う
  expect(normalizeNoteFontScale("0.7")).toBe(0.75);
});

test("＋で次の段へ、−で前の段へ動く", () => {
  expect(stepNoteFontScale(1, 1)).toBe(1.15);
  expect(stepNoteFontScale(1.3, -1)).toBe(1.15);
  expect(stepNoteFontScale(1, -1)).toBe(0.85);
});

// 端で止める。押し続けても行き過ぎない (ボタン側は disabled になるが、
// 判断はここ 1 か所に持たせる)
test("端では動かない", () => {
  expect(stepNoteFontScale(0.75, -1)).toBe(0.75);
  expect(stepNoteFontScale(2, 1)).toBe(2);
});

test("倍率は百分率の文字で見せる", () => {
  expect(noteFontScaleLabel(0.75)).toBe("75%");
  expect(noteFontScaleLabel(1)).toBe("100%");
  expect(noteFontScaleLabel(1.15)).toBe("115%");
  expect(noteFontScaleLabel(2)).toBe("200%");
});

// 初回描画前に走るインラインスクリプト。TS 側と同じ寄せ方をするかを、
// localStorage / document を差し替えて実際に走らせて確かめる
// (ここがずれると、読み込み直後だけ別の大きさで描かれる)
function runInitScript(stored: string | null): string | null {
  let applied: string | null = null;
  const localStorage = { getItem: () => stored };
  const document = {
    documentElement: {
      style: {
        setProperty(name: string, value: string) {
          expect(name).toBe(NOTE_FONT_SCALE_VAR);
          applied = value;
        },
      },
    },
  };
  new Function("localStorage", "document", NOTE_FONT_SCALE_INIT_SCRIPT)(
    localStorage,
    document,
  );
  return applied;
}

test("インラインスクリプトが保存値を CSS 変数へ写す", () => {
  expect(runInitScript("1.3")).toBe("1.3");
  expect(runInitScript("1.2")).toBe("1.15");
  expect(runInitScript("0.75")).toBe("0.75");
});

// 等倍は CSS 側の既定と同じなので触らない。読み込みのたびに
// html へ style を書かせない (書けば書くほど hydration の差分が増える)
test("等倍と壊れた値では CSS 変数を触らない", () => {
  expect(runInitScript(null)).toBeNull();
  expect(runInitScript("1")).toBeNull();
  expect(runInitScript("abc")).toBeNull();
});

// localStorage を塞いでいるブラウザ (iOS のプライベート閲覧など) では
// getItem が投げる。本文が出ないより等倍で出るほうがよい
test("localStorage が投げても落ちない", () => {
  const localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
  };
  expect(() =>
    new Function("localStorage", "document", NOTE_FONT_SCALE_INIT_SCRIPT)(
      localStorage,
      {},
    ),
  ).not.toThrow();
});

test("保存先の鍵をスクリプトと TS で共有する", () => {
  expect(NOTE_FONT_SCALE_INIT_SCRIPT).toContain(NOTE_FONT_SCALE_KEY);
  // 既定は段の中に居ること (外れると ＋ / − の起点が定まらない)
  expect(NOTE_FONT_SCALES).toContain(DEFAULT_NOTE_FONT_SCALE);
});
