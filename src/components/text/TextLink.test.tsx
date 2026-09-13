import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MarkdownView } from "../MarkdownView";
import { TextLink } from "./TextLink";

const render = (href: string, label: string) =>
  renderToStaticMarkup(<TextLink href={href} label={label} />);

test("ファイル名つきのボタンとして描画する", () => {
  const html = render("/api/images/abc.md", "設計メモ.md");
  expect(html).toContain('<button type="button"');
  expect(html).toContain("設計メモ.md");
});

// PDF と同じ理由。<a href> のままだとハイドレーション前に押されたときに
// ブラウザ既定の遷移が起き、standalone PWA では戻る導線が無いまま
// テキストの生表示に閉じ込められる (41-QR-search/docs/12 の PDF ビューアの経緯)
test("テキストの URL へ遷移する要素を本文に置かない (ハイドレーション前の事故防止)", () => {
  const html = render("/api/images/abc.txt", "x.txt");
  expect(html).not.toContain("href=");
  expect(html).not.toContain('target="_blank"');
});

test("初期状態ではビューアのモーダルを描画しない", () => {
  const html = render("/api/images/abc.txt", "x.txt");
  expect(html).not.toContain("fixed inset-0");
  expect(html).not.toContain("読み込んでいます");
});

test("MarkdownView のテキスト添付は TextLink で描画する", () => {
  const html = renderToStaticMarkup(
    <MarkdownView markdown="![売上.csv](/api/images/abc.csv)" />,
  );
  expect(html).toContain('<button type="button"');
  expect(html).toContain("売上.csv");
  expect(html).not.toContain('href="/api/images/abc.csv"');
});
