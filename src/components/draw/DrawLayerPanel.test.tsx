import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { DrawLayerPanel } from "./DrawLayerPanel";

// セッション内レイヤのパネル (docs/50-お絵かきレイヤ計画.md §4) の初期状態を
// 静的描画で固定する (docs/96-シークレット・お絵かきのテスト計画.md §3-1)。
// 開閉・切り替えの操作は E2E (e2e/draw.spec.ts) が担う

const noop = () => {};

type Props = ComponentProps<typeof DrawLayerPanel>;

const CLOSED: Props = {
  active: 1,
  hidden: [],
  layerCounts: { 1: 0, 2: 0, 3: 0 },
  open: false,
  onToggleOpen: noop,
  onClose: noop,
  onSetActive: noop,
  onToggleHidden: noop,
  disabled: false,
};

const OPEN: Props = { ...CLOSED, open: true };

const render = (overrides: Partial<Props> = {}) =>
  renderToStaticMarkup(<DrawLayerPanel {...CLOSED} {...overrides} />);

// 正規表現のメタ文字 (aria-label の丸括弧など) をそのまま探せるようにする
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 属性で示す操作子の開始タグ
function tagWith(html: string, tag: string, attribute: string): string {
  const matched = new RegExp(`<${tag}[^>]*${escapeRe(attribute)}[^>]*>`).exec(html);
  if (!matched) {
    throw new Error(`${attribute} の <${tag}> が見つかりません`);
  }
  return matched[0];
}

// 「レイヤ N」の行 (menuitemradio) の開始タグ
const rowOf = (html: string, layer: number) => {
  const matched = new RegExp(
    `<button[^>]*role="menuitemradio"[^>]*>(?:(?!</button>).)*レイヤ ${layer}</span>`,
  ).exec(html);
  if (!matched) {
    throw new Error(`レイヤ ${layer} の行が見つかりません`);
  }
  return matched[0];
};

const isDisabled = (tag: string) => tag.includes('disabled=""');

test("閉じているときは「レイヤ N」のボタンだけで、メニューは出さない", () => {
  const html = render();

  const trigger = tagWith(html, "button", 'aria-haspopup="menu"');
  expect(trigger).toContain('aria-expanded="false"');
  expect(html).toContain(">レイヤ 1</button>");
  expect(html).not.toContain('role="menu"');
  expect(html).not.toContain("レイヤパネルを閉じる");
});

test("ボタンの文字はアクティブなレイヤの番号", () => {
  expect(render({ active: 3 })).toContain(">レイヤ 3</button>");
});

test("開くと 3 行のメニューを、手前 (3) が上になる順で並べる", () => {
  const html = render(OPEN);

  expect(tagWith(html, "button", 'aria-haspopup="menu"')).toContain('aria-expanded="true"');
  expect(html).toContain('role="menu"');
  expect(html.match(/role="menuitemradio"/g)?.length).toBe(3);
  const menu = html.slice(html.indexOf('role="menu"'));
  expect(menu.indexOf("レイヤ 3</span>")).toBeLessThan(menu.indexOf("レイヤ 2</span>"));
  expect(menu.indexOf("レイヤ 2</span>")).toBeLessThan(menu.indexOf("レイヤ 1</span>"));
});

test("アクティブな行だけ aria-checked が真で青い", () => {
  const html = render({ ...OPEN, active: 2 });

  expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
  expect(rowOf(html, 2)).toContain('aria-checked="true"');
  expect(rowOf(html, 2)).toContain("bg-blue-600");
  expect(rowOf(html, 1)).toContain('aria-checked="false"');
  expect(rowOf(html, 3)).toContain('aria-checked="false"');
});

// アクティブレイヤは隠せない (見えない場所に描かせない。docs/50 §2)
test("アクティブな行の目は disabled で、名前に (表示中・アクティブ) と添える", () => {
  const html = render(OPEN);

  const eye = tagWith(html, "button", 'aria-label="レイヤ 1 (表示中・アクティブ)"');
  expect(isDisabled(eye)).toBe(true);
  expect(eye).toContain('aria-pressed="true"');
});

test("表示中の他のレイヤの目は「レイヤ N を非表示」で押下状態が真", () => {
  const html = render(OPEN);

  for (const layer of [2, 3]) {
    const eye = tagWith(html, "button", `aria-label="レイヤ ${layer} を非表示"`);
    expect(isDisabled(eye)).toBe(false);
    expect(eye).toContain('aria-pressed="true"');
  }
  // 目のアイコンに斜線は無い (すべて表示中)
  expect(html).not.toContain('<line x1="3"');
});

test("隠しているレイヤの目は「レイヤ N を表示」で押下状態が偽、アイコンに斜線", () => {
  const html = render({ ...OPEN, hidden: [2] });

  const eye = tagWith(html, "button", 'aria-label="レイヤ 2 を表示"');
  expect(eye).toContain('aria-pressed="false"');
  expect(html).not.toContain("レイヤ 2 を非表示");
  expect(html.match(/<line x1="3"/g)?.length).toBe(1);
});

// どこに何があるか迷子にならないよう、行にオブジェクト数を添える (docs/50 §4)
test("各行にそのレイヤのオブジェクト数を添える", () => {
  const html = render({ ...OPEN, layerCounts: { 1: 2, 2: 0, 3: 5 } });

  expect(html).toContain('レイヤ 3</span><span class="ml-auto text-xs text-white/70">5</span>');
  expect(html).toContain('レイヤ 1</span><span class="ml-auto text-xs text-white/70">2</span>');
});

// パネルの外を押したら閉じる。canvas より前に敷く透明な覆い
test("開いているときはパネルの外を覆う閉じるボタンを敷く", () => {
  const html = render(OPEN);

  const overlay = tagWith(html, "button", 'aria-label="レイヤパネルを閉じる"');
  expect(overlay).toContain("fixed inset-0");
  // 覆いはメニューより手前に描かれるが、z は覆い (10) < メニュー (20)
  expect(html.indexOf("レイヤパネルを閉じる")).toBeLessThan(html.indexOf('role="menu"'));
});

test("disabled なら「レイヤ N」のボタンが止まる", () => {
  const html = render({ disabled: true });

  expect(isDisabled(tagWith(html, "button", 'aria-haspopup="menu"'))).toBe(true);
});
