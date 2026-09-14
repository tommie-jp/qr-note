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
