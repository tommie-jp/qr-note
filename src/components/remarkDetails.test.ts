import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { expect, test } from "vitest";
import { remarkDetails, remarkDetailsSyntax } from "./remarkDetails";

const render = (markdown: string) =>
  renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: [remarkGfm, remarkDetailsSyntax, remarkDetails] },
      markdown,
    ),
  );

test(":::details を details/summary にする", () => {
  const html = render(":::details[ログ]\n本文\n:::");
  expect(html).toContain("<details");
  expect(html).toContain("<summary>ログ</summary>");
  expect(html).toContain("本文");
});

test("ラベルを省くと既定の見出しを出す", () => {
  const html = render(":::details\n本文\n:::");
  expect(html).toContain("<summary>詳細</summary>");
  expect(html).toContain("本文");
});

test("中身は Markdown として描く", () => {
  const html = render(":::details[資料]\n- 項目1\n\n![図](/api/images/a.png)\n:::");
  expect(html).toContain("<li>項目1</li>");
  expect(html).toContain('src="/api/images/a.png"');
});

test("ラベルの中の強調も描く", () => {
  const html = render(":::details[**重要**な話]\n本文\n:::");
  expect(html).toContain("<summary><strong>重要</strong>な話</summary>");
});

test("既定では閉じた状態で描く", () => {
  expect(render(":::details[x]\n本文\n:::")).not.toContain("open");
});

// 知らない囲いを黙って消さない。mdast-util-to-hast の既定は中身だけ残して
// <div> にしてしまい、`:::foo` を書いた本人には「なぜか行が消えた」ようにしか
// 見えない
test("知らないブロック directive は囲いの行を文字で見せる", () => {
  const html = render(":::foo\nなかみ\n:::");
  expect(html).toContain(":::foo");
  expect(html).toContain("なかみ");
  expect(html).not.toContain("<details");
});

// 囲いごと他所から貼られることがある (Docusaurus の `:::tip` など)。
// 中身まで文字に潰すと、書いてあった強調やリンクが死ぬ
test("知らない囲いの中身は Markdown として描き続ける", () => {
  const html = render(":::tip\n**太字** と [link](https://example.com)\n:::");
  expect(html).toContain("<strong>太字</strong>");
  expect(html).toContain('href="https://example.com"');
});

test("閉じていない囲いでも中身を描く", () => {
  const html = render(":::foo\nなかみ");
  expect(html).toContain("なかみ");
});

// container だけを有効にしているので、text (`:語`) と leaf (`::語`) の記法は
// そもそも構文として読まれない。remark-directive をそのまま使うと
// `型:int` の ":int" が消える
test("文中の :語 はただの文字のまま", () => {
  const html = render("型:int です");
  expect(html).toContain("型:int です");
  expect(html).not.toContain("<div");
});

test("行頭の ::語 もただの文字のまま", () => {
  const html = render("::note[ほげ]");
  expect(html).toContain("::note[ほげ]");
  expect(html).not.toContain("<div");
});

test("時刻や比のコロンを壊さない", () => {
  expect(render("時刻 12:30:45")).toContain("時刻 12:30:45");
  expect(render("比 1:2:3")).toContain("比 1:2:3");
});

test("コロン直後の URL は自動リンクのまま", () => {
  const html = render("参考:https://example.com");
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain("参考:");
});

test("details の中に details を入れられる", () => {
  const html = render("::::details[外]\n:::details[内]\n本文\n:::\n::::");
  expect(html.match(/<details/g)).toHaveLength(2);
  expect(html).toContain("<summary>外</summary>");
  expect(html).toContain("<summary>内</summary>");
});
