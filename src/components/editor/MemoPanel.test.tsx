import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MemoPanel } from "./MemoPanel";

const render = (defaultMode: "markdown" | "text" | "edit") =>
  renderToStaticMarkup(
    <MemoPanel
      defaultMode={defaultMode}
      markdownView={<div>MD_VIEW</div>}
      textView={<div>TEXT_VIEW</div>}
      editForm={<div>EDIT_FORM</div>}
    />,
  );

test("初期表示ではデフォルトモードのパネルだけをマウントする", () => {
  // 開いていないタブの中身 (CodeMirror や mermaid) を読み込ませないため、
  // 一度も選択されていないパネルは DOM に置かない
  const html = render("markdown");
  expect(html).toContain("MD_VIEW");
  expect(html).not.toContain("TEXT_VIEW");
  expect(html).not.toContain("EDIT_FORM");
});

test("デフォルトが編集モードなら編集フォームだけをマウントする", () => {
  const html = render("edit");
  expect(html).toContain("EDIT_FORM");
  expect(html).not.toContain("MD_VIEW");
});

test("切替タブ (markdown / テキスト / 編集) を表示する", () => {
  const html = render("text");
  expect(html).toContain("markdown");
  expect(html).toContain("テキスト");
  expect(html).toContain("編集");
});

// 長押しの OS メニュー (docs/98-長押しメニュー抑止計画.md)。スマホでは画面全体で
// 止めていて (globals.css)、ノートの中身を読む・書くタブの中だけ戻す。
// タブの見出し (押す物) は戻さない
test("タブの中身だけが OS のメニューを戻す印を持つ", () => {
  const html = render("markdown");
  expect(html).toMatch(/<div data-os-menu="">\s*<div>MD_VIEW<\/div>/);
  expect(html.match(/data-os-menu/g)).toHaveLength(1);
});
