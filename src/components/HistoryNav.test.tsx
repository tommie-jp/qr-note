import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { HistoryNav } from "./HistoryNav";

// このリポジトリのコンポーネントテストは renderToStaticMarkup の静的描画だけで、
// 操作を伴うテストの土台 (jsdom / testing-library) を持たない
// (HeaderMenu.test.tsx と同じ方針)。ここで確かめられるのは初回描画までで、
// Navigation API による活性/非活性の切り替えはブラウザで実物を通して確認する。
const render = () => renderToStaticMarkup(<HistoryNav />);

test("戻る・進むの 2 ボタンを描く", () => {
  const html = render();
  expect(html).toContain('aria-label="前の画面に戻る"');
  expect(html).toContain('aria-label="次の画面に進む"');
});

// 初回描画 (サーバ側の想定) では履歴の可否が分からないので両方 disabled。
// クライアントでマウント後に Navigation API で活性化する
// (class に含まれる disabled: バリアントと数え違えないよう属性だけを数える)
test("初回描画では両方 disabled にする", () => {
  const html = render();
  expect(html.match(/disabled=""/g)?.length).toBe(2);
});

// standalone 限定表示だった頃の名残 (hidden / standalone:) が残っていないこと。
// ブラウザでも常時出す回帰チェック
test("常時表示にする (hidden / standalone: を持たない)", () => {
  const html = render();
  expect(html).not.toContain("standalone:");
  expect(html).not.toMatch(/class="[^"]*\bhidden\b/);
});

// 矢印は文字 (← →) ではなく SVG の三角。文字の ◀ ▶ は iOS が絵文字として
// 描き、色指定が効かなくなるため (docs/11 §5-2)
test("矢印は色の付いた三角アイコン (SVG) で描く", () => {
  const html = render();
  expect(html.match(/<svg/g)?.length).toBe(2);
  expect(html).toContain("text-sky-600");
  expect(html).not.toContain("←");
  expect(html).not.toContain("→");
});

// 隣り合う 2 ボタンは押し間違えやすいので、間を空ける
test("2 つのボタンの間に隙間を空ける", () => {
  expect(render()).toMatch(/class="[^"]*\bgap-/);
});
