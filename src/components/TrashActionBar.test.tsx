import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { TrashSort } from "@/lib/validation";
import type { ViewMode } from "@/lib/viewMode";
import { TrashActionBar } from "./TrashActionBar";

const noop = () => {};

const render = (
  view: ViewMode = "compact",
  sort: TrashSort = "deleted",
  isProd = true,
) =>
  renderToStaticMarkup(
    <TrashActionBar
      view={view}
      sort={sort}
      viewAction={noop}
      sortAction={noop}
      isProd={isProd}
    />,
  );

// ゴミ箱のバーは 2 スロットだけ (docs/67-ゴミ箱表示形式計画.md §4)。
// スキャン・画像検索・選択は出さない
test("表示と並び順の 2 つだけを出す", () => {
  const html = render();
  expect(html).toContain("小");
  expect(html).toContain("削除順");
  for (const absent of ["スキャン", "画像検索", "選択"]) {
    expect(html).not.toContain(absent);
  }
});

// 表示の循環は検索画面とまったく同じ (同じ ViewSlot を使う)
test("表示トグルは現在のモードを見せ、送信値は次のモードになる", () => {
  expect(render("compact")).toContain('value="card"');
  expect(render("card")).toContain('value="image"');
  expect(render("image")).toContain('value="compact"');
});

// 表示モードの cookie は検索一覧と共有する (端末ごとの好みなので画面で分けない)
test("表示の切替は検索一覧と同じ cookie に書く", () => {
  expect(render()).toContain('name="view"');
});

// 並び順は別 cookie。混ぜると、検索側が知らない「削除順」を既定へ倒すので
// ゴミ箱を開くたびに検索の並びが巻き戻る (src/lib/sortMode.ts)
test("並び順はゴミ箱専用の cookie 名で送る", () => {
  const html = render();
  expect(html).toContain('name="trashSort"');
  expect(html).not.toContain('name="sort"');
});

// 循環は 削除順 → 更新順 → アクセス順 → 番号順 → タイトル順 → 削除順。
// 既定 (削除順) が先頭で、残りは検索一覧と同じ並び
test("並び順は削除順を先頭にした 5 種別を循環する", () => {
  expect(render("compact", "deleted")).toContain('value="updated"');
  expect(render("compact", "updated")).toContain('value="accessed"');
  expect(render("compact", "title")).toContain('value="deleted"');
});

test("並び順のラベルと方向を読み上げに出す", () => {
  expect(render("compact", "deleted")).toContain(
    "並び順: 削除順・新しい順 (押すと更新順に切替、長押しで一覧)",
  );
  // 逆順でも種別のラベルは変わらず、方向だけが読み上げに出る (docs/64 §4)
  expect(render("compact", "deletedAsc")).toContain(
    "並び順: 削除順・古い順 (押すと更新順に切替、長押しで一覧)",
  );
});

// 検索語を持たないので hidden も要らない (ゴミ箱に検索窓は無い)
test("検索語の hidden は持たない", () => {
  expect(render()).not.toContain('name="q"');
});

test("長押しメニューは既定では閉じている", () => {
  const html = render();
  expect(html).not.toContain('role="menu"');
  expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(2);
});

// 非本番はヘッダー・検索画面のバーと同じくピンクに塗る
test("非本番はピンク、本番は白の帯にする", () => {
  expect(render("compact", "deleted", false)).toContain("bg-pink-100/95");
  expect(render("compact", "deleted", true)).toContain("bg-white/95");
});

test("一覧がバーに隠れないよう余白を確保する", () => {
  expect(render()).toContain("env(safe-area-inset-bottom)");
});
