import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Item } from "@/generated/prisma/client";
import { tagSearchHref } from "@/lib/tags";
import { ImageMasonry } from "./ImageMasonry";

const IMAGE_1 = "0421547b-ee29-4613-a6d4-da0f41f94054.jpg";
const IMAGE_2 = "9f8e7d6c-5b4a-4321-8765-4321fedcba98.webp";

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    itemNo: "1",
    itemNoNum: 1,
    memo: "",
    url: "",
    mode: "memo",
    title: "",
    tags: [],
    props: [],
    taskTodo: 0,
    taskDone: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    accessedAt: new Date("2024-01-01T00:00:00Z"),
    deletedAt: null,
    publicAt: null,
    offlinePin: false,
    ...overrides,
  };
}

const render = (items: Item[]) =>
  renderToStaticMarkup(<ImageMasonry items={items} itemHref={(no) => `/item/${no}`} />);

test("1 ノートの複数画像をすべてタイルにし、どれもノート詳細へ繋ぐ", () => {
  const html = render([
    makeItem({
      itemNo: "4951",
      memo: `写真\n![](/api/images/${IMAGE_1})\n![](/api/images/${IMAGE_2})`,
    }),
  ]);
  // 2 枚とも出る。原寸ではなくサムネを引く (docs/23 §2)
  expect(html).toContain(`/api/images/${IMAGE_1}?thumb=1`);
  expect(html).toContain(`/api/images/${IMAGE_2}?thumb=1`);
  // タイルごとにノート詳細へのリンク
  const links = html.match(/href="\/item\/4951"/g);
  expect(links).toHaveLength(2);
  // どのノートの画像か判る番号 (キャプション 1 行目)
  expect(html).toContain("#4951");
});

test("タイルに #番号・タイトル・タグの 2 行キャプションを添える (compact 準拠)", () => {
  const html = render([
    makeItem({
      itemNo: "88",
      memo: "ネジ M3\n![](/api/images/" + IMAGE_1 + ")",
      tags: ["ねじ", "在庫"],
    }),
  ]);
  // 1 行目: #番号 とタイトル (memoSummary)
  expect(html).toContain("#88");
  expect(html).toContain("ネジ M3");
  // 2 行目: タグはタグ検索への別リンク (ノート詳細とは別の行き先)
  expect(html).toContain("#ねじ");
  expect(html).toContain(`href="${tagSearchHref("ねじ")}"`);
  expect(html).toContain(`href="${tagSearchHref("在庫")}"`);
});

test("タグの無いノートではタグ行を出さない", () => {
  const html = render([
    makeItem({ itemNo: "89", memo: `見出し\n![](/api/images/${IMAGE_1})`, tags: [] }),
  ]);
  // タイトルは出るが、タグ検索リンクは 1 つも無い
  expect(html).toContain("見出し");
  expect(html).not.toContain("/?q=");
});

test("画像のないノートはタイルにならない", () => {
  const html = render([
    makeItem({ itemNo: "10", memo: `![](/api/images/${IMAGE_1})` }),
    makeItem({ itemNo: "20", memo: "文章だけのノート" }),
  ]);
  expect(html).toContain('href="/item/10"');
  expect(html).not.toContain('href="/item/20"');
});

test("URL モードのノート (memo が空) が混ざっても落ちず、タイルにも出ない", () => {
  const html = render([
    makeItem({ itemNo: "30", mode: "url", url: "https://example.com" }),
    makeItem({ itemNo: "40", memo: `![](/api/images/${IMAGE_1})` }),
  ]);
  expect(html).not.toContain('href="/item/30"');
  expect(html).toContain('href="/item/40"');
});

test("ページ内に画像が 1 枚も無ければ案内だけを出す", () => {
  const html = render([
    makeItem({ itemNo: "50", memo: "画像なし" }),
    makeItem({ itemNo: "60", mode: "url", url: "https://example.com" }),
  ]);
  expect(html).toContain("このページには画像がありません");
  expect(html).not.toContain("/api/images/");
});

test("行優先で埋まる Grid で組む (multi-column ではない)", () => {
  const html = render([
    makeItem({ itemNo: "70", memo: `![](/api/images/${IMAGE_1})` }),
  ]);
  // 行優先 (1,2 / 3,4) で並ぶよう Grid にする。列数は画面幅に決めさせる
  // (docs/32 §1)。縦詰めになる multi-column には戻さない
  expect(html).toContain("grid");
  expect(html).toContain("auto-fill");
  expect(html).not.toContain("columns-");
  // 枠は aspect-square で固定してレイアウトシフトを消しつつ、object-contain で
  // 画像全体を余白付きで見せる (切り抜かない。docs/32 §1)
  expect(html).toContain("aspect-square");
  expect(html).toContain("object-contain");
  // 20 件 × 複数枚が並ぶので遅延読み込み
  expect(html).toContain('loading="lazy"');
});
