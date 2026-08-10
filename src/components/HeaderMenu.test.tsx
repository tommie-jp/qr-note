import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { HeaderMenu } from "./HeaderMenu";

// このリポジトリのコンポーネントテストは renderToStaticMarkup の静的描画だけで、
// 操作を伴うテストの土台 (jsdom / testing-library) を持たない
// (docs/09-スキャン計画.md §7 と同じ方針)。ここで確かめられるのは
// 「閉じている状態の描画」までで、開閉・Escape・外側タップ・背面スクロールの
// 固定はブラウザで実物を通して確認する (docs/11-アプリ的UIUX計画.md §6)。
const render = () =>
  renderToStaticMarkup(
    <HeaderMenu bgClass="bg-white/95">
      <a href="/logs">ログ</a>
    </HeaderMenu>,
  );

test("開閉ボタンに開いていない旨とメニューである旨を持たせる", () => {
  const html = render();
  expect(html).toContain('aria-label="メニュー"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-haspopup="menu"');
});

// 閉じている間は中身を描かない。押すまで項目が DOM に存在しないので、
// 「見えていないのに読み上げやタブ順に現れる」ことがない
test("閉じている間は項目を描かない", () => {
  expect(render()).not.toContain("/logs");
});
