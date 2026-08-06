import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Item } from "@/generated/prisma/client";
import { BulkTagToolbar } from "./BulkTagToolbar";

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    itemNo: "1",
    itemNoNum: 1,
    memo: "",
    url: "",
    mode: "memo",
    tags: [],
    props: [],
    taskTodo: 0,
    taskDone: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    accessedAt: new Date("2024-01-01T00:00:00Z"),
    deletedAt: null,
    publicAt: null,
    ...overrides,
  };
}

const noop = () => {};

const render = (items: Item[], selected: Set<string>) =>
  renderToStaticMarkup(
    <BulkTagToolbar
      items={items}
      selected={selected}
      trashAction={noop}
      onSelectAll={noop}
      onClear={noop}
      onCancel={noop}
    />,
  );

test("選択件数を表示する", () => {
  const html = render([makeItem({ itemNo: "1" })], new Set(["1"]));
  expect(html).toContain("1 件を選択中");
});

test("追加入力欄と追加ボタンを出す", () => {
  const html = render([makeItem({ itemNo: "1" })], new Set(["1"]));
  expect(html).toContain('name="addTags"');
  expect(html).toContain("追加");
});

test("選択アイテムのタグを削除チップ (removeTag 送信ボタン) にする", () => {
  const items = [makeItem({ itemNo: "1", tags: ["bjt", "npn"] })];
  const html = render(items, new Set(["1"]));
  expect(html).toContain('name="removeTag"');
  expect(html).toContain('value="bjt"');
  expect(html).toContain('value="npn"');
});

test("未選択なら削除チップを出さず、追加を無効化する", () => {
  const html = render([makeItem({ itemNo: "1", tags: ["bjt"] })], new Set());
  expect(html).not.toContain('name="removeTag"');
  expect(html).toContain("disabled");
});

// ゴミ箱 (docs/12-ゴミ箱計画.md §5)。タグの「削除」チップと紛らわしくないよう、
// ノートを消す方は行き先を言う「ゴミ箱へ」にしてある
test("選択中はノートをゴミ箱へ入れるボタンを出す", () => {
  const html = render([makeItem({ itemNo: "1" })], new Set(["1"]));
  expect(html).toContain("ゴミ箱へ");
});

test("未選択ならゴミ箱へボタンも無効化する", () => {
  const html = render([makeItem({ itemNo: "1" })], new Set());
  expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*ゴミ箱へ/);
});

test("タグのチップは「タグを削除」と明示する (ノートの削除と区別する)", () => {
  const html = render([makeItem({ itemNo: "1", tags: ["bjt"] })], new Set(["1"]));
  expect(html).toContain("タグを削除:");
});

// 選択エクスポート (docs/28-エクスポート計画.md §7)。親フォームはサーバー
// アクション宛なので、送り先とメソッドをボタン側で上書きする。文字列の
// formAction が付いた送信ボタンは React が preventDefault せず、ブラウザの
// 素の送信 (= ダウンロード) に戻る
test("選択中はエクスポートボタンを出す (POST /api/export)", () => {
  const html = render([makeItem({ itemNo: "1" })], new Set(["1"]));
  expect(html).toContain('formAction="/api/export"');
  expect(html).toContain('formMethod="post"');
  // 全件と選択を同じ口で受けるので、どちらかをボタン自身の値で伝える
  const exportButton = /<button[^>]*formAction="\/api\/export"[^>]*>/.exec(html)?.[0];
  expect(exportButton).toContain('name="scope"');
  expect(exportButton).toContain('value="selected"');
});

test("未選択ならエクスポートも無効化する", () => {
  const html = render([makeItem({ itemNo: "1" })], new Set());
  expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*エクスポート/);
});
