import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { DRAW_WIDTH_OPTIONS } from "@/lib/draw/drawPrefs";
import { DrawToolbar } from "./DrawToolbar";

// お絵かきの道具立ての初期状態を静的描画で固定する
// (docs/96-シークレット・お絵かきのテスト計画.md §3-1)。
// 押したときの挙動 (道具の切り替え・拡大) は E2E (e2e/draw.spec.ts) が担う

const noop = () => {};

type Props = ComponentProps<typeof DrawToolbar>;

const IDLE: Props = {
  tool: "pen",
  onTool: noop,
  color: "#ff3b30",
  onColor: noop,
  width: 6,
  onWidth: noop,
  canUndo: false,
  canRedo: false,
  onUndo: noop,
  onRedo: noop,
  onClear: noop,
  disabled: false,
  zoom: 1,
  canZoomIn: true,
  canZoomOut: false,
  onZoomIn: noop,
  onZoomOut: noop,
  onZoomReset: noop,
};

const render = (overrides: Partial<Props> = {}) =>
  renderToStaticMarkup(<DrawToolbar {...IDLE} {...overrides} />);

const TOOL_LABELS = [
  "ペン",
  "マーカー",
  "塗る",
  "矢印",
  "四角",
  "丸",
  "モザイク",
  "消しゴム",
  "選択",
  "文字",
  "移動",
] as const;

// 文字で示すボタンの開始タグ (`<button …>ペン</button>` の `<button …>`)
function buttonLabelled(html: string, label: string): string {
  const matched = new RegExp(`<button[^>]*>${label}</button>`).exec(html);
  if (!matched) {
    throw new Error(`ボタン「${label}」が見つかりません`);
  }
  return matched[0];
}

// aria-label で示す操作子 (色・太さ・拡大縮小) の開始タグ
function controlLabelled(html: string, tag: string, ariaLabel: string): string {
  const matched = new RegExp(`<${tag}[^>]*aria-label="${ariaLabel}"[^>]*>`).exec(html);
  if (!matched) {
    throw new Error(`${ariaLabel} の <${tag}> が見つかりません`);
  }
  return matched[0];
}

const isDisabled = (tag: string) => tag.includes('disabled=""');

test("11 の道具を並べ、選んでいる道具だけ aria-pressed が真", () => {
  const html = render();

  for (const label of TOOL_LABELS) {
    expect(html).toContain(`>${label}</button>`);
  }
  expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
  expect(html.match(/aria-pressed="false"/g)?.length).toBe(TOOL_LABELS.length - 1);
  expect(buttonLabelled(html, "ペン")).toContain('aria-pressed="true"');
});

test("選んだ道具が変わると押下状態もその道具へ移る", () => {
  const html = render({ tool: "eraser" });

  expect(buttonLabelled(html, "消しゴム")).toContain('aria-pressed="true"');
  expect(buttonLabelled(html, "ペン")).toContain('aria-pressed="false"');
});

// 選んでいる道具は青、それ以外は白抜き。別々のクラスにして Tailwind の
// 定義順で背景色が競合しないようにしている (DrawToolbar の注)
test("選んでいる道具は青、それ以外は白抜きの別クラス", () => {
  const html = render();

  expect(buttonLabelled(html, "ペン")).toContain("bg-blue-600");
  expect(buttonLabelled(html, "マーカー")).toContain("bg-white/15");
  expect(buttonLabelled(html, "マーカー")).not.toContain("bg-blue-600");
});

test("色と太さの入力にいまの値が入る", () => {
  const html = render({ color: "#00aaff", width: 12 });

  expect(controlLabelled(html, "input", "色")).toContain('type="color"');
  expect(controlLabelled(html, "input", "色")).toContain('value="#00aaff"');
  expect(html).toContain('<option value="12" class="text-gray-900" selected="">太さ 12</option>');
  expect(html.match(/<option /g)?.length).toBe(DRAW_WIDTH_OPTIONS.length);
});

// 太さ・色が効かない道具では選択肢を伏せる (迷わせない)
test("消しゴムは色を、塗るは太さを、移動は両方を伏せる", () => {
  const pen = render({ tool: "pen" });
  expect(isDisabled(controlLabelled(pen, "input", "色"))).toBe(false);
  expect(isDisabled(controlLabelled(pen, "select", "太さ"))).toBe(false);

  const eraser = render({ tool: "eraser" });
  expect(isDisabled(controlLabelled(eraser, "input", "色"))).toBe(true);
  expect(isDisabled(controlLabelled(eraser, "select", "太さ"))).toBe(false);

  const fill = render({ tool: "fill" });
  expect(isDisabled(controlLabelled(fill, "input", "色"))).toBe(false);
  expect(isDisabled(controlLabelled(fill, "select", "太さ"))).toBe(true);

  for (const tool of ["mosaic", "select", "pan"] as const) {
    const html = render({ tool });
    expect(isDisabled(controlLabelled(html, "input", "色"))).toBe(true);
    expect(isDisabled(controlLabelled(html, "select", "太さ"))).toBe(true);
  }
});

test("履歴が無いとき 元に戻す/やり直す は disabled、あれば押せる", () => {
  const none = render();
  expect(isDisabled(buttonLabelled(none, "元に戻す"))).toBe(true);
  expect(isDisabled(buttonLabelled(none, "やり直す"))).toBe(true);

  const both = render({ canUndo: true, canRedo: true });
  expect(isDisabled(buttonLabelled(both, "元に戻す"))).toBe(false);
  expect(isDisabled(buttonLabelled(both, "やり直す"))).toBe(false);
});

test("全消しは履歴に関わらず押せる (赤いボタン)", () => {
  const html = render();

  expect(isDisabled(buttonLabelled(html, "全消し"))).toBe(false);
  expect(buttonLabelled(html, "全消し")).toContain("bg-red-600/80");
});

// 拡大は「移動」道具でのピンチでも変えられるが、ボタンは指の無い環境と
// 倍率を戻す手立てのために置く (docs/36-お絵かき拡張計画.md §4)
test("全体表示 (100%) では縮小と全体を表示が disabled、拡大だけ押せる", () => {
  const html = render();

  expect(isDisabled(controlLabelled(html, "button", "縮小"))).toBe(true);
  expect(isDisabled(controlLabelled(html, "button", "全体を表示"))).toBe(true);
  expect(isDisabled(controlLabelled(html, "button", "拡大"))).toBe(false);
  expect(html).toContain(">100%</button>");
});

test("拡大中は倍率を % で出し、縮小と全体を表示が押せる", () => {
  const html = render({ zoom: 2.5, canZoomOut: true, canZoomIn: true });

  expect(html).toContain(">250%</button>");
  expect(isDisabled(controlLabelled(html, "button", "縮小"))).toBe(false);
  expect(isDisabled(controlLabelled(html, "button", "全体を表示"))).toBe(false);
  expect(isDisabled(controlLabelled(html, "button", "拡大"))).toBe(false);
});

test("上限まで拡大すると拡大だけが disabled", () => {
  const html = render({ zoom: 4, canZoomOut: true, canZoomIn: false });

  expect(html).toContain(">400%</button>");
  expect(isDisabled(controlLabelled(html, "button", "拡大"))).toBe(true);
  expect(isDisabled(controlLabelled(html, "button", "縮小"))).toBe(false);
});

// 準備中・挿入中 (isBusy) は帯ごと止める。11 道具 + 色 + 太さ + 履歴 2 +
// 全消し + 拡大縮小 3 = 19 の操作子がすべて disabled
test("disabled ならすべての操作子が止まる", () => {
  const html = render({ disabled: true, canUndo: true, canRedo: true, zoom: 2, canZoomOut: true });

  expect(html.match(/disabled=""/g)?.length).toBe(TOOL_LABELS.length + 8);
});

// 狭い端末でも畳まず、はみ出した分は横に流す
test("帯は横スクロールで、道具は 44px 四方を確保する", () => {
  const html = render();

  expect(html).toContain("overflow-x-auto");
  expect(buttonLabelled(html, "ペン")).toContain("min-h-11");
});
