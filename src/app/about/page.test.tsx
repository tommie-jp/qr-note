import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import AboutPage from "./page";

// クレジットページ (docs/46-クレジット表記計画.md)。
// Server Component だが JSX を返すだけ (DB も session も触らない) なので、
// そのまま静的レンダリングして中身を見る

const html = () => renderToStaticMarkup(<AboutPage />);

// Yahoo! の規定 HTML の一字一句の固定は YahooAttribution.test.tsx が持つ。
// ここでは総覧ページにそれが載っている (コンポーネントが繋がっている) ことだけ見る
test("Yahoo! の規定クレジットが載っている", () => {
  expect(html()).toContain(
    '<a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a>',
  );
});

// 楽天・openBD・NDL のリンク先は SERVICE_LINKS に集約 (docs/95)。ここでは
// 総覧ページにその URL 集合が載り続けること (共有の回帰) を見る。
// 楽天は API ドキュメント (books-book-search) を指す — トップに戻したら落とす
test("楽天・openBD・NDL の帰属も出す (適切なページへ)", () => {
  const out = html();
  expect(out).toContain(
    "https://webservice.rakuten.co.jp/documentation/books-book-search",
  );
  expect(out).toContain("https://openbd.jp/");
  expect(out).toContain("https://ndlsearch.ndl.go.jp/");
});

// docs/46 §3-1。設定系と違いログイン・デモに依らず出す。
// ここでは「requireUser や notFound を呼ばずに素で描ける」ことを担保する
// (それらを呼んでいれば、このプレーンなレンダリングが投げる)
test("ログイン状態に依らず素で描ける (見出しが出る)", () => {
  expect(html()).toContain("クレジット");
});
