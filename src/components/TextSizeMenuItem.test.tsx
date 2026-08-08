import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TextSizeMenuItem } from "./TextSizeMenuItem";

// HeaderMenu.test.tsx と同じ制約 — このリポジトリは jsdom を持たないので、
// 確かめられるのは「開いた直後の描画」まで。＋ / − の押し心地と、
// 押してもシートが閉じないことはブラウザで実物を通して確認する
// (docs/61-テキストサイズ計画.md §5)
const render = () => renderToStaticMarkup(<TextSizeMenuItem />);

test("行の名前と現在の倍率を出す", () => {
  const html = render();
  expect(html).toContain("テキストサイズ");
  expect(html).toContain("100%");
});

test("拡大・縮小・等倍に戻すを読み上げ用の名前付きで出す", () => {
  const html = render();
  expect(html).toContain('aria-label="大きく"');
  expect(html).toContain('aria-label="小さく"');
  // 倍率の表示を押すと等倍に戻る。名前には**倍率も**入れる — 用途だけに
  // すると、画面に出ている今の倍率が読み上げからだけ消える
  expect(html).toContain('aria-label="100%。押すと等倍に戻す"');
});

// ＋ / − に焦点が当たったまま値だけが変わるので、押した結果を読む場所が要る
test("倍率の変化を読み上げる live region を持つ", () => {
  expect(render()).toContain('aria-live="polite"');
});

// 等倍は段の途中 (75%〜200% の中の 100%) なので、どちら向きにも動ける。
// 端での disabled は stepNoteFontScale の「端では動かない」が担保しており、
// SSR で確かめられるのは初期状態だけ (jsdom を持たない。冒頭のコメント参照)
test("等倍では両方向に動かせる", () => {
  // 属性そのものを見る ("disabled" の文字列は Tailwind の disabled: 変体
  // クラスにも現れるので、それには反応させない)
  expect(render()).not.toContain('disabled=""');
});
