import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { YahooAttribution } from "./YahooAttribution";

// Yahoo! の規定クレジット (docs/46 §1-1 / docs/94)。規約で改変が禁止なので、
// 規定 HTML が一字一句そのまま出ることをここで固定する — 誰かが CSS で色を
// 変えたり、文言・リンク先・span の inline style を触ったら落とす。
// (掲示先の /about・編集画面は、このコンポーネントを置くだけ)
test("規定 HTML を一字一句そのまま出す", () => {
  const out = renderToStaticMarkup(<YahooAttribution />);
  expect(out).toContain(
    '<span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span>',
  );
});
