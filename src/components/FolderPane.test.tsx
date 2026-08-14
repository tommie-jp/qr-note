import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Sort } from "@/lib/validation";
import { FolderPane } from "./FolderPane";

const render = (
  query = "",
  sort: Sort = "updated",
  trashCount = 2,
  saved: string[] = [],
) =>
  renderToStaticMarkup(
    <FolderPane
      tags={[
        { tag: "電験三種", count: 30 },
        { tag: "npn", count: 3 },
      ]}
      totals={{ total: 578, untagged: 41 }}
      trashCount={trashCount}
      saved={saved}
      query={query}
      sort={sort}
    />,
  );

test("特殊フォルダーとタグを検索リンクとして並べる", () => {
  const html = render();
  // フォルダーはすべて既存の検索へのリンク (docs/86 §5)
  expect(html).toContain('href="/"');
  expect(html).toContain('href="/?sort=accessed"');
  expect(html).toContain('href="/?q=is%3Auntagged"');
  expect(html).toContain('href="/trash"');
  expect(html).toContain(
    `href="${`/?q=${encodeURIComponent("#電験三種")}`}"`,
  );
  // 件数バッジ
  expect(html).toContain("578");
  expect(html).toContain("41");
  expect(html).toContain("30");
});

test("空検索では「すべて」が開いている印になる", () => {
  const html = render("");
  expect(html.split('aria-current="page"').length - 1).toBe(1);
  expect(html).toMatch(/aria-current="page"[^>]*>[^<]*<[^>]*>すべて/);
});

test("アクセス順の空検索は「最近」(逆順も同じ)", () => {
  for (const sort of ["accessed", "accessedAsc"] as const) {
    const html = render("", sort);
    expect(html.split('aria-current="page"').length - 1).toBe(1);
    expect(html).toMatch(/aria-current="page"[^>]*>[^<]*<[^>]*>最近/);
  }
});

test("タグ検索は該当タグの行だけが開いている印になる (大小は同一視)", () => {
  const html = render("#NPN");
  expect(html.split('aria-current="page"').length - 1).toBe(1);
  expect(html).toMatch(/aria-current="page"[^>]*>[^<]*<[^>]*>#npn/);
});

test("is:untagged は「未分類」が開いている印になる", () => {
  const html = render("is:untagged");
  expect(html.split('aria-current="page"').length - 1).toBe(1);
  expect(html).toMatch(/aria-current="page"[^>]*>[^<]*<[^>]*>未分類/);
});

test("ゴミ箱が空なら行ごと出さない", () => {
  const html = render("", "updated", 0);
  expect(html).not.toContain('href="/trash"');
});

// ☆ 登録パターン (docs/59 §7) をスマートフォルダーとして並べる (docs/86 §6)

test("登録パターンは検索リンクとして並び、一致中は印が付く", () => {
  const html = render("#英単語 is:todo", "updated", 0, [
    "#英単語 is:todo",
    "#理論 #易",
  ]);
  expect(html).toContain("登録パターン");
  expect(html).toContain(
    `href="${`/?q=${encodeURIComponent("#理論 #易")}`}"`,
  );
  expect(html.split('aria-current="page"').length - 1).toBe(1);
  expect(html).toMatch(/aria-current="page"[^>]*>[^<]*<[^>]*>★ #英単語 is:todo/);
});

test("登録パターンが無ければ節ごと出さない", () => {
  expect(render()).not.toContain("登録パターン");
});

test("件数がまだ無くても骨組み (特殊フォルダーとタグ) は描く", () => {
  // Suspense の fallback に使う形 (docs/86 §5)。ペインの有無で一覧の幅が
  // 変わるので、件数を待たずに器だけ先に出す
  const html = renderToStaticMarkup(
    <FolderPane tags={[{ tag: "npn", count: 3 }]} query="" sort="updated" />,
  );
  expect(html).toContain("data-folder-pane");
  expect(html).toContain("すべて");
  expect(html).toContain("#npn");
  expect(html).not.toContain('href="/trash"');
});
