import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { NoteChromeProvider } from "@/components/notechrome/NoteChromeProvider";
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

// ノートの操作を畳む (docs/108-ノート全画面表示計画.md)。
// 静的描画では portal の差し込み口がまだ無いので、畳むときは操作が
// 1 つも描かれず、本文と畳まない物 (バナー) だけが出る
const chrome = {
  heading: <h1>HEADING</h1>,
  tags: <ul>TAGS</ul>,
  notices: <p>NOTICES</p>,
  footer: <div>FOOTER</div>,
  badge: <span>BADGE</span>,
};

const renderWithChrome = (
  defaultMode: "markdown" | "text" | "edit",
  { inProvider }: { inProvider: boolean },
) => {
  const panel = (
    <MemoPanel
      defaultMode={defaultMode}
      markdownView={<div>MD_VIEW</div>}
      textView={<div>TEXT_VIEW</div>}
      editForm={<div>EDIT_FORM</div>}
      chrome={chrome}
    />
  );
  return renderToStaticMarkup(
    inProvider ? <NoteChromeProvider>{panel}</NoteChromeProvider> : panel,
  );
};

test("畳める器の中で読むタブなら、操作を描かず本文とバナーだけを出す", () => {
  const html = renderWithChrome("markdown", { inProvider: true });
  expect(html).toContain("MD_VIEW");
  expect(html).toContain("NOTICES");
  expect(html).not.toContain("HEADING");
  expect(html).not.toContain("TAGS");
  expect(html).not.toContain("FOOTER");
  expect(html).not.toContain('role="tablist"');
});

test("編集タブで開いたときは畳まず、従来の順に積む", () => {
  const html = renderWithChrome("edit", { inProvider: true });
  const order = ["HEADING", "NOTICES", "TAGS", 'role="tablist"', "EDIT_FORM", "FOOTER"];
  const positions = order.map((needle) => html.indexOf(needle));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  // 公開中の印は畳んでいる間だけの物
  expect(html).not.toContain("BADGE");
});

test("畳める器の外 (公開ビュー) では読むタブでも積む", () => {
  const html = renderWithChrome("markdown", { inProvider: false });
  expect(html).toContain("HEADING");
  expect(html).toContain("TAGS");
  expect(html).toContain('role="tablist"');
  expect(html).toContain("FOOTER");
});
