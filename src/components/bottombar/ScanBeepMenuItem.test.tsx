import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ScanBeepMenuItem } from "./ScanBeepMenuItem";

// TextSizeMenuItem.test.tsx と同じ制約 — jsdom を持たないので、確かめられる
// のは開いた直後の描画まで。押し心地と試し鳴りはブラウザと実機で確かめる
// (docs/112-スキャン音量計画.md)
const render = () => renderToStaticMarkup(<ScanBeepMenuItem />);

test("行の名前と既定の段 (大) を出す", () => {
  const html = render();
  expect(html).toContain("スキャン音");
  expect(html).toContain(">大<");
});

test("小さく・大きく・既定に戻すを読み上げ用の名前付きで出す", () => {
  const html = render();
  expect(html).toContain('aria-label="スキャン音を小さく"');
  expect(html).toContain('aria-label="スキャン音を大きく"');
  expect(html).toContain('aria-label="大。押すと大に戻す"');
});

test("段の変化を読み上げる live region を持つ", () => {
  expect(render()).toContain('aria-live="polite"');
});

// 既定の「大」は上の端。＋だけが押せない
test("既定では大きくだけが押せない", () => {
  const html = render();
  const disabled = html.match(/disabled=""/g) ?? [];
  expect(disabled).toHaveLength(1);
  expect(html).toMatch(/aria-label="スキャン音を大きく" disabled=""/);
});
