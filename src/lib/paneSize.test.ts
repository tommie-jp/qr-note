import { describe, expect, test } from "vitest";
import {
  PANE_SIZES,
  PANE_SIZE_INIT_SCRIPT,
  clampPaneSize,
  paneSizeFromPointer,
  paneSizeValue,
} from "./paneSize";

describe("clampPaneSize", () => {
  test("範囲内はそのまま (0.1 刻みに丸める)", () => {
    expect(clampPaneSize("folder", 16)).toBe(16);
    expect(clampPaneSize("folder", 16.34)).toBe(16.3);
    expect(clampPaneSize("preview", 60)).toBe(60);
  });

  test("範囲外は既定ではなくいちばん近い端へ寄せる", () => {
    expect(clampPaneSize("folder", 2)).toBe(PANE_SIZES.folder.min);
    expect(clampPaneSize("folder", 999)).toBe(PANE_SIZES.folder.max);
    expect(clampPaneSize("preview", 0)).toBe(PANE_SIZES.preview.min);
    expect(clampPaneSize("preview", 100)).toBe(PANE_SIZES.preview.max);
  });

  test("数として読めないものだけ既定に落とす", () => {
    expect(clampPaneSize("folder", null)).toBe(PANE_SIZES.folder.default);
    expect(clampPaneSize("folder", "ひろく")).toBe(PANE_SIZES.folder.default);
    expect(clampPaneSize("preview", undefined)).toBe(PANE_SIZES.preview.default);
  });

  test("保存された文字列 ('14') も読める", () => {
    expect(clampPaneSize("folder", "18")).toBe(18);
  });
});

test("paneSizeValue は CSS に書ける単位付きの文字列にする", () => {
  expect(paneSizeValue("folder", 18)).toBe("18rem");
  expect(paneSizeValue("preview", 60)).toBe("60dvh");
});

// ポインタ → 寸法。CSS 側の置き方 (左端から / 下部バーのぶん上で終わる) と
// 対になっている計算なので、代表的な位置で確かめる
describe("paneSizeFromPointer", () => {
  const geometry = {
    clientX: 0,
    clientY: 0,
    rootFontSizePx: 16,
    viewportHeightPx: 1000,
    bottomBarPx: 49,
  };

  test("フォルダーは画面左端からポインタまでの幅 (rem)", () => {
    // 288px / 16px = 18rem
    expect(paneSizeFromPointer("folder", { ...geometry, clientX: 288 })).toBe(18);
  });

  test("プレビューは下部バーの上からポインタまでの高さ (dvh)", () => {
    // 1000 - 49 - 451 = 500px → 50dvh
    expect(paneSizeFromPointer("preview", { ...geometry, clientY: 451 })).toBe(50);
  });

  test("画面の外まで引いても上下限で止まる", () => {
    expect(paneSizeFromPointer("folder", { ...geometry, clientX: -100 })).toBe(
      PANE_SIZES.folder.min,
    );
    expect(paneSizeFromPointer("preview", { ...geometry, clientY: 0 })).toBe(
      PANE_SIZES.preview.max,
    );
  });

  test("root の font-size が読めなくても 0 除算にならない", () => {
    expect(
      paneSizeFromPointer("folder", {
        ...geometry,
        clientX: 224,
        rootFontSizePx: 0,
      }),
    ).toBe(14);
  });
});

// 先回りスクリプト (layout.tsx が <head> に置く) は、上の実装と同じ答えを
// 出さなければならない。ずれると読み込み直後だけ別の寸法で描かれる
describe("PANE_SIZE_INIT_SCRIPT", () => {
  const run = (stored: Record<string, string>) => {
    const applied: Record<string, string> = {};
    const localStorage = {
      getItem: (key: string) => stored[key] ?? null,
    };
    const document = {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => {
            applied[name] = value;
          },
        },
      },
    };
    new Function("localStorage", "document", PANE_SIZE_INIT_SCRIPT)(
      localStorage,
      document,
    );
    return applied;
  };

  test("保存された寸法を CSS 変数として当てる", () => {
    expect(run({ "pane-folder-w": "18", "pane-preview-h": "60" })).toEqual({
      "--folder-pane-w": "18rem",
      "--preview-pane-h": "60dvh",
    });
  });

  test("実装 (clampPaneSize) と同じ丸め・同じ端へ寄せる", () => {
    for (const raw of ["2", "999", "16.34", "0", "100", "45"]) {
      const applied = run({ "pane-folder-w": raw, "pane-preview-h": raw });
      expect(applied["--folder-pane-w"]).toBe(
        paneSizeValue("folder", clampPaneSize("folder", raw)),
      );
      expect(applied["--preview-pane-h"]).toBe(
        paneSizeValue("preview", clampPaneSize("preview", raw)),
      );
    }
  });

  test("保存が無い / 読めない値なら何も当てない (CSS の既定のまま)", () => {
    expect(run({})).toEqual({});
    expect(run({ "pane-folder-w": "ひろく" })).toEqual({});
  });

  test("localStorage を塞いでいても投げない", () => {
    expect(() =>
      new Function("localStorage", "document", PANE_SIZE_INIT_SCRIPT)(
        {
          getItem() {
            throw new Error("blocked");
          },
        },
        {},
      ),
    ).not.toThrow();
  });
});
