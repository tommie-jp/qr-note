import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { DrawModal } from "./DrawModal";
import type { DrawCanvasApi } from "./useDrawCanvas";

// お絵かき画面 (docs/34-お絵かき計画.md §2) の初期状態を、fabric を持つ
// useDrawCanvas を差し替えて静的描画で固定する
// (docs/96-シークレット・お絵かきのテスト計画.md §3-1)。
// 見るのは 4 状態 — 準備中・下敷きの失敗・空・描画済み。描く操作そのものは
// E2E (e2e/draw.spec.ts) が担う
//
// - useDrawCanvas: fabric の canvas を作る本物は document が要る (node には無い)。
//   DrawCanvasApi をそのまま満たす動かない値を返す
// - react-dom の createPortal: サーバ描画は portal を描けない (投げる) ので、
//   子をその場に描く形に差し替える。document.body を渡す式そのものは評価
//   されるため、document も空の物を置く

const mocks = vi.hoisted(() => ({
  api: null as unknown,
}));

vi.mock("./useDrawCanvas", () => ({
  useDrawCanvas: () => mocks.api,
}));

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    createPortal: (children: ReactNode) => children,
  };
});

vi.stubGlobal("document", {});

const noop = () => {};

const PREPARING: DrawCanvasApi = {
  size: null,
  displayScale: 1,
  isPreparing: true,
  error: null,
  canUndo: false,
  canRedo: false,
  isEmpty: true,
  layerCounts: { 1: 0, 2: 0, 3: 0 },
  undo: noop,
  redo: noop,
  clear: noop,
  exportImage: async () => ({ blob: new Blob(), extension: "png" }),
  cancelActiveInput: noop,
};

const EMPTY: DrawCanvasApi = {
  ...PREPARING,
  size: { width: 800, height: 600 },
  displayScale: 0.5,
  isPreparing: false,
};

const FAILED: DrawCanvasApi = {
  ...EMPTY,
  error: "背景にする画像を読み込めませんでした。白紙で描けます。",
};

const DRAWN: DrawCanvasApi = {
  ...EMPTY,
  isEmpty: false,
  canUndo: true,
  layerCounts: { 1: 3, 2: 0, 3: 0 },
};

beforeEach(() => {
  mocks.api = EMPTY;
});

const render = (api: DrawCanvasApi, sourceImageUrl: string | null = null) => {
  mocks.api = api;
  return renderToStaticMarkup(
    <DrawModal sourceImageUrl={sourceImageUrl} onCancel={noop} onInsert={noop} />,
  );
};

// 文字で示すボタンの開始タグ
function buttonLabelled(html: string, label: string): string {
  const matched = new RegExp(`<button[^>]*>${label}</button>`).exec(html);
  if (!matched) {
    throw new Error(`ボタン「${label}」が見つかりません`);
  }
  return matched[0];
}

const isDisabled = (tag: string) => tag.includes('disabled=""');

test("お絵かきという名前のモーダルダイアログで、見出し・レイヤ・ツールバー・挿入を持つ", () => {
  const html = render(EMPTY);

  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain('aria-label="お絵かき"');
  expect(html).toContain("<h2 class=\"font-medium\">お絵かき</h2>");
  expect(html).toContain(">レイヤ 1</button>");
  expect(html).toContain(">ペン</button>");
  expect(html).toContain("<canvas></canvas>");
  expect(html).toContain(">本文に挿入</button>");
  expect(html).toContain(">閉じる</button>");
});

test("準備中: 案内を出し、道具と挿入は止めるが閉じるは押せる", () => {
  const html = render(PREPARING);

  expect(html).toContain("準備しています…");
  expect(isDisabled(buttonLabelled(html, "ペン"))).toBe(true);
  expect(isDisabled(buttonLabelled(html, "全消し"))).toBe(true);
  expect(isDisabled(buttonLabelled(html, "レイヤ 1"))).toBe(true);
  expect(isDisabled(buttonLabelled(html, "本文に挿入"))).toBe(true);
  expect(isDisabled(buttonLabelled(html, "閉じる"))).toBe(false);
  // 器の寸法が決まるまで canvas の枠に style は付かない
  expect(html).not.toContain("transform:scale(");
  expect(html).not.toContain("class=\"mx-3 mb-2");
});

test("下敷きの失敗: 赤い知らせに文言を出し、白紙のまま描ける", () => {
  const html = render(FAILED, "/api/images/a.png");

  expect(html).toContain('aria-live="polite"');
  expect(html).toContain("背景にする画像を読み込めませんでした。白紙で描けます。");
  expect(html).not.toContain("準備しています…");
  expect(isDisabled(buttonLabelled(html, "ペン"))).toBe(false);
  expect(isDisabled(buttonLabelled(html, "本文に挿入"))).toBe(true);
});

test("空: 知らせは無く、道具は使えるが挿入と履歴は止まっている", () => {
  const html = render(EMPTY);

  expect(html).not.toContain('aria-live="polite"');
  expect(html).not.toContain("準備しています…");
  expect(isDisabled(buttonLabelled(html, "ペン"))).toBe(false);
  expect(isDisabled(buttonLabelled(html, "レイヤ 1"))).toBe(false);
  expect(isDisabled(buttonLabelled(html, "本文に挿入"))).toBe(true);
  expect(isDisabled(buttonLabelled(html, "元に戻す"))).toBe(true);
  expect(isDisabled(buttonLabelled(html, "やり直す"))).toBe(true);
});

test("描画済み: 挿入と元に戻すが押せる", () => {
  const html = render(DRAWN);

  expect(isDisabled(buttonLabelled(html, "本文に挿入"))).toBe(false);
  expect(isDisabled(buttonLabelled(html, "元に戻す"))).toBe(false);
  expect(isDisabled(buttonLabelled(html, "やり直す"))).toBe(true);
  expect(html).toContain("本文に挿入");
  expect(html).not.toContain("挿入中…");
});

test("開いた直後の道具はペンで、色と太さは既定値", () => {
  const html = render(EMPTY);

  expect(html).toContain('aria-pressed="true" class="inline-flex min-h-11 shrink-0 items-center justify-center rounded px-3 font-medium transition active:scale-95 disabled:opacity-40 disabled:active:scale-100 bg-blue-600 text-white">ペン</button>');
  expect(html).toContain('value="#ff3b30"');
  expect(html).toContain('<option value="6" class="text-gray-900" selected="">太さ 6</option>');
  expect(html).toContain(">100%</button>");
});

// 論理サイズ (= 書き出す解像度) はそのまま、表示は CSS で縮める (docs/34 §3)。
// 送りは transform で行い、スクロールさせない (docs/36 §4-3)
test("器は論理サイズのまま置き、表示倍率で縮めた枠に収める", () => {
  const html = render(EMPTY);

  expect(html).toContain("width:400px;height:300px;transform:translate(0px, 0px)");
  expect(html).toContain("width:800px;height:600px;transform:scale(0.5);transform-origin:top left");
  expect(html).toContain("touch-none overflow-hidden");
});

test("下敷きの候補があれば「白紙にする」を出し、無ければ出さない", () => {
  expect(render(EMPTY, "/api/images/a.png")).toContain(">白紙にする</button>");

  const blank = render(EMPTY);
  expect(blank).not.toContain("白紙にする");
  expect(blank).not.toContain("画像に描く");
});

test("移動の道具でないので枠は掴む手のカーソルにならない", () => {
  expect(render(EMPTY)).not.toContain("cursor-grab");
});
