import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { expect, test } from "vitest";
import { remarkAlerts } from "./remarkAlerts";

// MarkdownView と同じ並び (remarkBreaks の後ろ) で確かめる。
// 目印は blockquote の class だけを見る — 見た目の組み立ては
// MarkdownAlert 側の仕事で、このプラグインの責任ではない
const render = (markdown: string) =>
  renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: [remarkGfm, remarkBreaks, remarkAlerts] },
      markdown,
    ),
  );

test.each([
  ["NOTE", "alert-note"],
  ["TIP", "alert-tip"],
  ["IMPORTANT", "alert-important"],
  ["WARNING", "alert-warning"],
  ["CAUTION", "alert-caution"],
])("[!%s] を %s クラスの引用にする", (marker, className) => {
  const html = render(`> [!${marker}]\n> 本文`);
  expect(html).toContain(className);
  expect(html).toContain("本文");
});

test("目印の行は本文から取り除く", () => {
  const html = render("> [!NOTE]\n> 補足です");
  expect(html).not.toContain("[!NOTE]");
  expect(html).toContain("補足です");
  // 目印を消した跡に空行 (<br/>) を残さない
  expect(html).not.toContain("<br/>補足です");
});

test("小文字の目印も受け付ける", () => {
  expect(render("> [!note]\n> 本文")).toContain("alert-note");
});

test("知らない種類はただの引用のまま (文字も消さない)", () => {
  const html = render("> [!FOO]\n> 本文");
  expect(html).not.toContain("alert-");
  expect(html).toContain("[!FOO]");
});

test("目印のない引用はそのまま", () => {
  const html = render("> ふつうの引用");
  expect(html).not.toContain("alert-");
  expect(html).toContain("ふつうの引用");
});

test("本文のない目印だけでも壊れない", () => {
  const html = render("> [!WARNING]");
  expect(html).toContain("alert-warning");
  expect(html).not.toContain("[!WARNING]");
});

test("複数行・箇条書きを含む本文を保つ", () => {
  const html = render("> [!TIP]\n> 一行目\n>\n> - 項目1\n> - 項目2");
  expect(html).toContain("alert-tip");
  expect(html).toContain("一行目");
  expect(html).toContain("<li>項目1</li>");
});

test("行頭以外の [!NOTE] は目印にしない", () => {
  const html = render("> 本文 [!NOTE] のこと");
  expect(html).not.toContain("alert-");
  expect(html).toContain("[!NOTE]");
});

// remarkBreaks を通さない経路でも同じ結果になること (プラグインの並び順に
// 依存していない = 並べ替えで静かに壊れない)
test("remarkBreaks なしでも目印を解釈する", () => {
  const html = renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: [remarkGfm, remarkAlerts] },
      "> [!NOTE]\n> 補足です",
    ),
  );
  expect(html).toContain("alert-note");
  expect(html).not.toContain("[!NOTE]");
  expect(html).toContain("補足です");
});
