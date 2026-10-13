import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { VERSION as breadboardVersion } from "breadboard-fence/core";
import { VERSION as circuitVersion } from "circuit-fence/core";
import { VERSION as logicVersion } from "logic-fence/core";
import pkg from "../../../package.json";
import AboutPage from "./page";

// クレジットページ (docs/46-クレジット表記計画.md)。
// Server Component だが JSX を返すだけ (DB も session も触らない) なので、
// そのまま静的レンダリングして中身を見る

const html = () => renderToStaticMarkup(<AboutPage />);

// Yahoo! の規定 HTML の一字一句の固定は components/chrome/YahooAttribution.test.tsx が持つ。
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

// tommie-fence (図のフェンス) の節。版は各パッケージの VERSION (取り込み済みの
// tgz) から読むので、手で書いた番号が古くならない。
// 版は fence ごとに独立している (揃えない) ので、一覧で出す
test("tommie-fence の説明・版と、qr-note・tommie-fence の GitHub URL とデモ版の URL を出す", () => {
  const out = html();
  expect(out).toContain("tommie-fence");
  expect(out).toContain("https://github.com/tommie-jp/tommie-fence");
  expect(out).toContain("https://github.com/tommie-jp/qr-note");
  expect(out).toContain("https://qr-demo.tommie.jp");
  expect(out).toContain(`circuit-fence ${circuitVersion}`);
  expect(out).toContain(`breadboard-fence ${breadboardVersion}`);
  expect(out).toContain(`logic-fence ${logicVersion}`);
});

// アプリ自身の版。package.json から読むので、版を上げれば追随する
test("QR Note 自身の版を出す", () => {
  expect(html()).toContain(`v${pkg.version}`);
});

// 第三者ライセンスの一覧 (ビルド時に生成) と、同梱しているモデル・フォント。
// ブラウザへ配っているので、ライセンス上の表記が要る
test("第三者ライセンスの一覧へのリンクと、モデル・フォントの表記を出す", () => {
  const out = html();
  expect(out).toContain('href="/third-party-licenses.txt"');
  expect(out).toContain("PP-OCRv5");
  expect(out).toContain("DINOv2");
  expect(out).toContain("BaKoMa");
  expect(out).toContain("Apache-2.0");
});

// 外へ送るものと、端末の中だけで済むもの
test("データの行き先を書く", () => {
  const out = html();
  expect(out).toContain("JAN");
  expect(out).toContain("端末の中");
});

// 本番に取り込んだ教科書のノートの出典 (CC BY 4.0)
test("教科書のリポジトリを出す", () => {
  expect(html()).toContain(
    "https://github.com/tommie-jp/tommie-circuit-workbook",
  );
});

// QR Note 自身のライセンス (リポジトリ直下の LICENSE と package.json の license)
test("QR Note のライセンスを出す", () => {
  expect(pkg.license).toBe("MIT");
  expect(html()).toContain("で公開しています (MIT)。デモ版は");
});
