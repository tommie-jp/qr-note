import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { AttributionFooter, SERVICE_LINKS } from "./AttributionFooter";

const html = () => renderToStaticMarkup(<AttributionFooter />);

// Yahoo! の規定 HTML は改変禁止なので、フッターに包んでも一字一句そのまま
// 出ること (YahooAttribution 経由。docs/95)
test("Yahoo! の規定クレジットを改変せず含む", () => {
  expect(html()).toContain(
    '<span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span>',
  );
});

// 使っている他サービス (楽天・openBD・国会) の適切なページへの導線も出す (docs/95)
test("楽天・openBD・国会の各リンクを出す", () => {
  const out = html();
  for (const service of Object.values(SERVICE_LINKS)) {
    expect(out).toContain(`href="${service.href}"`);
    expect(out).toContain(service.label);
  }
});

// 楽天は汎用トップではなく、実際に叩いている書籍検索 API のドキュメントを指す
// (適切なページ。docs/95 §2)。トップ (webservice.rakuten.co.jp/) に戻したら落とす
test("楽天リンクは書籍検索 API のドキュメントを指す", () => {
  expect(SERVICE_LINKS.rakutenBooks.href).toBe(
    "https://webservice.rakuten.co.jp/documentation/books-book-search",
  );
});
