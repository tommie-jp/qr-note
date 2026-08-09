import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Item } from "@/generated/prisma/client";
import type { ViewMode } from "@/lib/viewMode";
import { TrashList } from "./TrashList";

const noop = () => {};

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    itemNo: "1234",
    itemNoNum: 1234,
    memo: "2SC1815",
    url: "",
    mode: "memo",
    title: "2SC1815",
    tags: [],
    props: [],
    taskTodo: 0,
    taskDone: 0,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    accessedAt: new Date("2026-07-01T00:00:00Z"),
    deletedAt: new Date("2026-07-15T03:04:05Z"),
    publicAt: null,
    offlinePin: false,
    ...overrides,
  };
}

const render = (
  items: Item[],
  view: ViewMode = "compact",
  circuitThumbs?: Record<string, string[]>,
  mathTexts?: Record<string, { title?: string; preview?: string }>,
) =>
  renderToStaticMarkup(
    <TrashList
      items={items}
      view={view}
      restoreAction={noop}
      purgeAction={noop}
      emptyTrashAction={noop}
      circuitThumbs={circuitThumbs}
      mathTexts={mathTexts}
    />,
  );

test("各ノートの番号・見出し・削除日時を出す", () => {
  const html = render([makeItem()]);
  expect(html).toContain("#1234");
  expect(html).toContain("2SC1815");
  // JST 固定・ゼロ埋め (03:04:05 UTC = 12:04:05 JST)
  expect(html).toContain("2026/07/15 12:04:05");
});

test("行ごとに復元と永久削除を出す", () => {
  const html = render([makeItem()]);
  expect(html).toContain("復元");
  expect(html).toContain("永久削除");
  expect(html).toContain('value="1234"');
});

test("ゴミ箱が空なら一覧も「空にする」も出さない", () => {
  const html = render([]);
  expect(html).toContain("ゴミ箱は空です");
  expect(html).not.toContain("永久削除");
  expect(html).not.toContain("空にする");
});

test("1 件以上あれば「ゴミ箱を空にする」を出す", () => {
  const html = render([makeItem(), makeItem({ itemNo: "4951" })]);
  expect(html).toContain("空にする");
});

// 番号が解放されてシールが別の部品を指しうることを知らせる
// (docs/12-ゴミ箱計画.md §4)
test("永久削除で番号が再利用されうる注意を出す", () => {
  const html = render([makeItem()]);
  expect(html).toContain("番号");
  expect(html).toContain("シール");
});

test("ノートへのリンクを張る (中身を確かめてから消せるように)", () => {
  const html = render([makeItem()]);
  expect(html).toContain('href="/item/1234"');
});

// --- 表示形式 (docs/67-ゴミ箱表示形式計画.md §3) ---
//
// 検索一覧と同じ 3 形式を出す。描画は同じ部品 (ItemRow / ImageMasonry) に
// 委ねるので、ここで確かめるのは「形式ごとに描き分かれていること」と
// 「どの形式でも復元の導線を失わないこと」

test("小表示は 1 カラムの一覧 (区切り線で仕切る)", () => {
  const html = render([makeItem()], "compact");
  expect(html).toContain("divide-y");
  expect(html).not.toContain("grid");
});

// 大表示は本文プレビュー付きのカードをグリッドに敷き詰める
test("大表示はカードのグリッドで、本文プレビューも出す", () => {
  const html = render(
    [makeItem({ memo: "2SC1815\n\nNPN トランジスタ。hFE ランク Y" })],
    "card",
  );
  expect(html).toContain("grid");
  expect(html).not.toContain("divide-y");
  expect(html).toContain("NPN トランジスタ");
  // カードでも行ごとの操作は消えない
  expect(html).toContain("永久削除");
});

const IMAGE = "0421547b-ee29-4613-a6d4-da0f41f94054.jpg";

test("画像表示は本文の画像をタイルに敷き詰める", () => {
  const html = render(
    [makeItem({ itemNo: "10", memo: `![](/api/images/${IMAGE})` })],
    "image",
  );
  expect(html).toContain(`/api/images/${IMAGE}?thumb=1`);
  expect(html).toContain('href="/item/10"');
});

// タイルは「画像 1 枚 = 1 リンク」でノート単位ではないので、取り返しの付かない
// 永久削除を並べない。代わりに、どこで操作できるかをその場で言う
test("画像表示では行ごとの操作を出さず、行き先を案内する", () => {
  const html = render(
    [makeItem({ itemNo: "10", memo: `![](/api/images/${IMAGE})` })],
    "image",
  );
  expect(html).not.toContain(">復元<");
  expect(html).toContain("ノートを開くか");
  // 「ゴミ箱を空にする」は一覧全体への操作なのでどの形式でも残す
  expect(html).toContain("空にする");
});

// 回路図サムネの中継 (docs/68-一覧回路図サムネ計画.md §5)。
// ゴミ箱でも「消してよいか」の判断材料は検索一覧と同じだけ要る

const CIRCUIT_SVG = '<svg viewBox="0 0 10 10"><path d="M0 0h10"/></svg>';

test("小表示は回路図サムネを行へ降ろす", () => {
  const html = render([makeItem({ itemNo: "10", memo: "RC 回路" })], "compact", {
    "10": [CIRCUIT_SVG],
  });
  expect(html).toContain("circuit-thumb");
  expect(html).toContain('<path d="M0 0h10"/>');
});

test("画像表示は回路図サムネを masonry へ降ろす", () => {
  const html = render([makeItem({ itemNo: "10", memo: "RC 回路" })], "image", {
    "10": [CIRCUIT_SVG],
  });
  expect(html).toContain("circuit-thumb");
  expect(html).toContain('href="/item/10"');
});

// 数式入りタイトルの中継 (docs/69-一覧数式計画.md)

test("小表示は数式 HTML を行へ降ろす", () => {
  const html = render(
    [makeItem({ itemNo: "10", memo: "$E=100$ の回路" })],
    "compact",
    undefined,
    { "10": { title: '<span class="katex">E=100</span>' } },
  );
  expect(html).toContain('class="katex"');
  expect(html).not.toContain("$E=100$");
});
