import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Item } from "@/generated/prisma/client";
import { tagSearchHref } from "@/lib/markdown/tags/tags";
import { ImageMasonry, tileCountOf } from "./ImageMasonry";
import { SearchTileMenuProvider } from "./row-actions/TileActions";

const IMAGE_1 = "0421547b-ee29-4613-a6d4-da0f41f94054.jpg";
const IMAGE_2 = "9f8e7d6c-5b4a-4321-8765-4321fedcba98.webp";

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    itemId: "00000000-0000-7000-8000-000000000001",
    memo: "",
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

const render = (
  items: Item[],
  circuitThumbs?: Record<string, string[]>,
  mathTexts?: Record<string, { title?: string; preview?: string }>,
  previewItemId?: string | null,
) =>
  renderToStaticMarkup(
    <ImageMasonry
      items={items}
      itemHref={(no) => `/item/${no}`}
      circuitThumbs={circuitThumbs}
      mathTexts={mathTexts}
      previewItemId={previewItemId}
    />,
  );

test("1 ノートの複数画像をすべてタイルにし、どれもノート詳細へ繋ぐ", () => {
  const html = render([
    makeItem({
      itemId: "00000000-0000-7000-8000-000000004951",
      memo: `写真\n![](/api/images/${IMAGE_1})\n![](/api/images/${IMAGE_2})`,
    }),
  ]);
  // 2 枚とも出る。原寸ではなくサムネを引く (docs/23 §2)
  expect(html).toContain(`/api/images/${IMAGE_1}?thumb=1`);
  expect(html).toContain(`/api/images/${IMAGE_2}?thumb=1`);
  // タイルごとにノート詳細へのリンク
  const links = html.match(/href="\/item\/00000000-0000-7000-8000-000000004951"/g);
  expect(links).toHaveLength(2);
  // どのノートの画像か判る見出し (キャプション 1 行目)
  expect(html).toContain("写真");
});

test("タイルにタイトル・タグの 2 行キャプションを添える (compact 準拠)", () => {
  const html = render([
    makeItem({
      itemId: "00000000-0000-7000-8000-000000000088",
      memo: "ネジ M3\n![](/api/images/" + IMAGE_1 + ")",
      tags: ["ねじ", "在庫"],
    }),
  ]);
  // 1 行目: タイトル (memoSummary)。行頭の #番号 は出さない (id は UUID で
  // 人が読む物ではない。docs/107 §4-4)
  expect(html).toContain("ネジ M3");
  expect(html).not.toContain("00000000-0000-7000-8000-000000000088<");
  // 2 行目: タグはタグ検索への別リンク (ノート詳細とは別の行き先)
  expect(html).toContain("#ねじ");
  expect(html).toContain(`href="${tagSearchHref("ねじ")}"`);
  expect(html).toContain(`href="${tagSearchHref("在庫")}"`);
});

test("タグの無いノートではタグ行を出さない", () => {
  const html = render([
    makeItem({ itemId: "00000000-0000-7000-8000-000000000089", memo: `見出し\n![](/api/images/${IMAGE_1})`, tags: [] }),
  ]);
  // タイトルは出るが、タグ検索リンクは 1 つも無い
  expect(html).toContain("見出し");
  expect(html).not.toContain("/?q=");
});

test("画像のないノートはタイルにならない", () => {
  const html = render([
    makeItem({ itemId: "00000000-0000-7000-8000-000000000010", memo: `![](/api/images/${IMAGE_1})` }),
    makeItem({ itemId: "00000000-0000-7000-8000-000000000020", memo: "文章だけのノート" }),
  ]);
  expect(html).toContain('href="/item/00000000-0000-7000-8000-000000000010"');
  expect(html).not.toContain('href="/item/00000000-0000-7000-8000-000000000020"');
});

test("本文が URL だけのノートが混ざっても落ちず、タイルにも出ない", () => {
  const html = render([
    makeItem({ itemId: "00000000-0000-7000-8000-000000000030", memo: "https://example.com" }),
    makeItem({ itemId: "00000000-0000-7000-8000-000000000040", memo: `![](/api/images/${IMAGE_1})` }),
  ]);
  expect(html).not.toContain('href="/item/00000000-0000-7000-8000-000000000030"');
  expect(html).toContain('href="/item/00000000-0000-7000-8000-000000000040"');
});

test("ページ内に画像が 1 枚も無ければ案内だけを出す", () => {
  const html = render([
    makeItem({ itemId: "00000000-0000-7000-8000-000000000050", memo: "画像なし" }),
    makeItem({ itemId: "00000000-0000-7000-8000-000000000060", memo: "https://example.com" }),
  ]);
  expect(html).toContain("このページには画像・動画・回路図がありません");
  expect(html).not.toContain("/api/images/");
});

// 回路図タイル (docs/68-一覧回路図サムネ計画.md §4)

// 回路図の SVG の hash (docs/124 §1)。タイルは届くまで同じ大きさの枠だけを出す
const CIRCUIT_SVG = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CIRCUIT_SVG_2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test("回路図をタイルとして並べ、ノート詳細へ繋ぐ", () => {
  const html = render([makeItem({ itemId: "00000000-0000-7000-8000-000000000090", memo: "RC 回路" })], {
    "00000000-0000-7000-8000-000000000090": [CIRCUIT_SVG],
  });
  expect(html).toContain("circuit-thumb");
  // SVG の中身は端末が口から引いて入れる。描いた直後は同じ大きさの枠だけ
  expect(html).toContain('<span aria-hidden="true" class="circuit-thumb block aspect-square w-full bg-gray-100"></span>');
  expect(html).toContain('href="/item/00000000-0000-7000-8000-000000000090"');
  // キャプション (compact 準拠の 2 行) も画像タイルと同じに出す
  expect(html).toContain("RC 回路");
});

test("同じノートの画像タイルの後に回路図タイルを並べる", () => {
  const html = render(
    [makeItem({ itemId: "00000000-0000-7000-8000-000000000091", memo: `図と写真\n![](/api/images/${IMAGE_1})` })],
    { "00000000-0000-7000-8000-000000000091": [CIRCUIT_SVG, CIRCUIT_SVG_2] },
  );
  // 画像 1 + 回路図 2 = タイル 3 枚 (どれもノート詳細へ)
  expect(html.match(/href="\/item\/00000000-0000-7000-8000-000000000091"/g)).toHaveLength(3);
  // 画像タイルが先、回路図タイルが後
  const imagePos = html.indexOf(`/api/images/${IMAGE_1}`);
  const circuitPos = html.indexOf("circuit-thumb");
  expect(imagePos).toBeGreaterThan(-1);
  expect(circuitPos).toBeGreaterThan(imagePos);
});

test("回路図の SVG が無いノートは今までどおり画像タイルだけ", () => {
  const html = render([
    makeItem({ itemId: "00000000-0000-7000-8000-000000000092", memo: `![](/api/images/${IMAGE_1})` }),
  ]);
  expect(html).toContain(`/api/images/${IMAGE_1}`);
  expect(html).not.toContain("circuit-thumb");
});

test("画像も回路図も無いページは案内だけを出す (文言は両方に触れる)", () => {
  const html = render([makeItem({ itemId: "00000000-0000-7000-8000-000000000093", memo: "文章だけ" })]);
  expect(html).toContain("このページには画像・動画・回路図がありません");
});

test("行優先で埋まる Grid で組む (multi-column ではない)", () => {
  const html = render([
    makeItem({ itemId: "00000000-0000-7000-8000-000000000070", memo: `![](/api/images/${IMAGE_1})` }),
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

// 数式入りキャプション (docs/69-一覧数式計画.md)

test("mathTexts のタイトルがあればキャプションを KaTeX の HTML で出す", () => {
  const html = render(
    [makeItem({ itemId: "00000000-0000-7000-8000-000000000095", memo: `$E=100$ の回路\n![](/api/images/${IMAGE_1})` })],
    undefined,
    { "00000000-0000-7000-8000-000000000095": { title: '<span class="katex">E=100</span>' } },
  );
  expect(html).toContain('class="katex"');
  expect(html).not.toContain("$E=100$");
});

// プレビューペインで開いているノートの印 (docs/86 §4)

test("プレビュー中のノートのタイルにだけ選択の印を付ける", () => {
  const html = render(
    [
      makeItem({ itemId: "00000000-0000-7000-8000-000000000010", memo: `![](/api/images/${IMAGE_1})` }),
      makeItem({ itemId: "00000000-0000-7000-8000-000000000020", memo: `![](/api/images/${IMAGE_2})` }),
    ],
    undefined,
    undefined,
    "00000000-0000-7000-8000-000000000010",
  );
  expect(html.split('aria-current="page"').length - 1).toBe(1);
  // 枠色は CSS 変数で受ける (docs/88-選択行の色計画.md)。色そのものは
  // layout が html に立てるので、ここで確かめられるのは「印が付くか」だけ
  expect(html).toContain("border-[var(--row-tint-border)]");
});

test("プレビューを開いていなければ選択の印は無い", () => {
  const html = render([
    makeItem({ itemId: "00000000-0000-7000-8000-000000000010", memo: `![](/api/images/${IMAGE_1})` }),
  ]);
  expect(html).not.toContain('aria-current="page"');
});

// タイルの ⋮ (docs/107-行メニュー計画.md §7)。検索一覧だけが立てて、
// 送信の状態を持つ SearchTileMenuProvider で包む
test("tileActions を立てると、タイルごとに ⋮ を出す", () => {
  const html = renderToStaticMarkup(
    <SearchTileMenuProvider
      trashAction={() => {}}
      searchState={{ q: "", page: 1, sort: "updated" }}
    >
      <ImageMasonry
        items={[
          makeItem({
            itemId: "00000000-0000-7000-8000-000000004951",
            memo: `![](/api/images/${IMAGE_1})\n![](/api/images/${IMAGE_2})`,
          }),
        ]}
        itemHref={(no) => `/item/${no}`}
        tileActions
      />
    </SearchTileMenuProvider>,
  );
  // 同じノートの 2 枚のどちらにも、ノートへの操作として出る。名乗りは
  // 見出しから作る呼び名 (lib/items/noteName.ts)。見出しが無ければ無題
  expect(html.match(/aria-label="無題のノートの操作"/g)).toHaveLength(2);
  expect(html).toContain('aria-haspopup="menu"');
});

test("見出しのあるノートの ⋮ は見出しで名乗る (#番号は使わない)", () => {
  const html = renderToStaticMarkup(
    <SearchTileMenuProvider
      trashAction={() => {}}
      searchState={{ q: "", page: 1, sort: "updated" }}
    >
      <ImageMasonry
        items={[
          makeItem({
            itemId: "00000000-0000-7000-8000-000000004951",
            memo: `抵抗\n![](/api/images/${IMAGE_1})`,
            // 呼び名は派生列の title から作る (一覧のタイトル順と同じ鍵)
            title: "抵抗",
          }),
        ]}
        itemHref={(no) => `/item/${no}`}
        tileActions
      />
    </SearchTileMenuProvider>,
  );
  expect(html).toContain('aria-label="「抵抗」の操作"');
  expect(html).not.toMatch(/aria-label="#/);
});

test("tileActions が無ければ ⋮ を出さない (ゴミ箱の一覧)", () => {
  const html = render([
    makeItem({ itemId: "00000000-0000-7000-8000-000000004951", memo: `![](/api/images/${IMAGE_1})` }),
  ]);
  expect(html).not.toContain("の操作");
});

// 動画タイル (docs/117 §8)。スライドショーで流すため、画像と同じく並べる
const VIDEO_1 = "2232f915-45fe-4121-836f-0fa6bbd9c4dc.mp4";

test("動画は poster と ▶ の印のタイルで、本文の出現順に画像と混ぜて並べる", () => {
  const html = render([
    makeItem({
      itemId: "00000000-0000-7000-8000-000000000095",
      memo: `動画と写真\n![録画](/api/images/${VIDEO_1})\n![](/api/images/${IMAGE_1})`,
    }),
  ]);
  // 動画 1 + 画像 1 = タイル 2 枚
  expect(html.match(/href="\/item\/00000000-0000-7000-8000-000000000095"/g)).toHaveLength(2);
  // poster は ?thumb=1 (サムネ列) を引く。原寸の動画は読まない
  expect(html).toContain(`/api/images/${VIDEO_1}?thumb=1`);
  expect(html).not.toContain(`/api/images/${VIDEO_1}"`);
  expect(html.indexOf(VIDEO_1)).toBeLessThan(html.indexOf(IMAGE_1));
});

test("動画だけのノートもタイルの数に入る (ゴミ箱の確認文・表示の判定)", () => {
  const item = makeItem({
    itemId: "00000000-0000-7000-8000-000000000096",
    memo: `![録画](/api/images/${VIDEO_1})`,
  });
  expect(tileCountOf(item)).toBe(1);
});
