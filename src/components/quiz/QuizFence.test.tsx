import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { QuizFence } from "./QuizFence";

// このリポジトリのコンポーネントテストは SSR した HTML を見る作法のため、
// ここで確かめられるのは**未解答の初期表示**まで。押した後の出し分けは
// QuizCard の choiceClassOf / markOf に寄せてある
const render = (code: string) =>
  renderToStaticMarkup(<QuizFence code={code} />);

// 選択肢のボタンだけを取り出す。カードには降参ボタンも並ぶので、
// <button> を数えるだけでは選択肢の数と一致しない。番号欄 ((1) など) の
// 有無で見分ける
const choiceButtons = (html: string): string[] =>
  (html.match(/<button[\s\S]*?<\/button>/g) ?? []).filter((b) =>
    /\(\d+\)/.test(b),
  );

const BASIC = [
  "問: スイッチを閉じた直後の電流 $i_0$ は。",
  "1. $0$ A",
  "2. $E/R$ A",
  "正解: 2",
  "解説: 直後のコンデンサは短絡とみなせる。",
].join("\n");

test("問題文と選択肢を出す", () => {
  const html = render(BASIC);
  expect(html).toContain("スイッチを閉じた直後の電流");
  expect(html).toContain("(1)");
  expect(html).toContain("(2)");
});

test("解答するまで正解と解説を出さない", () => {
  const html = render(BASIC);
  // 解説の**中身**で見る。「解説」の 2 文字は降参ボタンの文言にも入っており、
  // それで判定すると下のテストと食い違う
  expect(html).not.toContain("直後のコンデンサは短絡");
  expect(html).not.toContain("正解は");
  expect(html).not.toContain("やり直す");
});

// 全く分からない問題のための逃げ道 (docs/60-学習進捗計画.md §3)。
// 解説そのものは押すまで出ない (上のテスト) ので、CBT の出し分けは壊れない
test("解答しなくても解説を開くボタンは出す", () => {
  expect(render(BASIC)).toContain("わからない");
});

test("数式は KaTeX で描く", () => {
  expect(render(BASIC)).toContain("katex");
});

test("選択肢は button で、中に <p> を入れない", () => {
  const html = render(BASIC);
  const buttons = choiceButtons(html);
  expect(buttons).toHaveLength(2);
  // button の中身は phrasing content に限られる (段落を入れると不正な HTML)。
  // 問題文のほうは段落のままでよいので、ボタンの中だけを見る
  for (const button of buttons) {
    expect(button).not.toContain("<p>");
  }
});

// button の中身は phrasing content に限られる。選択肢に何を書かれても
// 見出し・リスト・タスクリストの <input> を button の中に入れない
test("選択肢のブロック要素は中身だけ残す", () => {
  const html = render("問: あ\n1. # 見出し\n2. - [ ] やる\n正解: 1");
  const buttons = choiceButtons(html);
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toContain("見出し");
  expect(buttons[0]).not.toContain("<h1");
  expect(buttons[1]).toContain("やる");
  expect(buttons[1]).not.toContain("<ul");
  expect(buttons[1]).not.toContain("<input");
});

// 入れ子だけ素の <a> だと、参照元 (ノートの URL) が外部サイトへ漏れる
test("カード内の外部リンクも本文と同じく rel と別タブを付ける", () => {
  // 解説は解答するまで描かれないので、問題文に置いて確かめる
  const html = render("問: [出典](https://example.com/x) より。\n1. い\n2. う\n正解: 1");
  expect(html).toContain('rel="noreferrer"');
  expect(html).toContain('target="_blank"');
});

test("生 HTML は本文と同じく落とす", () => {
  const html = render(
    '問: <script>alert("x")</script>あ\n1. い\n2. う\n正解: 1',
  );
  expect(html).not.toContain("<script");
});

test("書き方の誤りはエラーと元ソースを添えて出す", () => {
  const html = render("問: あ\n1. い\n2. う\n正解: 9");
  expect(html).toContain("問題の書き方のエラー");
  expect(html).toContain("正解: 9"); // 元ソースを添える
});

test("解説がなくても描ける", () => {
  expect(render("問: あ\n1. い\n2. う\n正解: 1")).toContain("(2)");
});
