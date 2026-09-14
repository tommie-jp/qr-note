import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MarkdownView } from "../markdown/MarkdownView";
import { PdfLink } from "./PdfLink";

const render = (href: string, label: string) =>
  renderToStaticMarkup(<PdfLink href={href} label={label} />);

test("ファイル名つきのボタンとして描画する", () => {
  const html = render("/api/images/abc.pdf", "仕様書.pdf");
  expect(html).toContain('<button type="button"');
  expect(html).toContain("仕様書.pdf");
  expect(html).toContain("📄");
});

// ここが要点。<a href> のままだとハイドレーション前に押されたときに
// ブラウザ既定の遷移が起き、standalone PWA で「開いたら戻れない」に落ちる
// (E2E で新しいタブが開くのを確認済み)。JS が付くまで何も起きない形にする
test("PDF の URL へ遷移する要素を本文に置かない (ハイドレーション前の事故防止)", () => {
  const html = render("/api/images/abc.pdf", "x.pdf");
  expect(html).not.toContain("href=");
  expect(html).not.toContain('target="_blank"');
});

test("初期状態ではビューアのモーダルを描画しない", () => {
  const html = render("/api/images/abc.pdf", "x.pdf");
  // モーダルは fixed inset-0 の器を持つ (ZoomableImage と同じ約束)
  expect(html).not.toContain("fixed inset-0");
  expect(html).not.toContain("読み込んでいます");
});

// 本文の PDF がビューア経由になっていること。ここが素の <a href> に戻ると、
// standalone PWA で「開いたら戻れない」不具合が再発する
test("MarkdownView の PDF は PdfLink で描画する", () => {
  const html = renderToStaticMarkup(
    <MarkdownView markdown="![仕様書.pdf](/api/images/abc.pdf)" />,
  );
  expect(html).toContain("📄");
  expect(html).toContain('<button type="button"');
  expect(html).toContain("仕様書.pdf");
  // 本文から PDF へ直接遷移する導線を残さない
  expect(html).not.toContain('href="/api/images/abc.pdf"');
});
