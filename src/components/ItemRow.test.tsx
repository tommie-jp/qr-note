import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Item } from "@/generated/prisma/client";
import { ItemRow, type RowViewMode } from "./ItemRow";

const IMAGE = "0421547b-ee29-4613-a6d4-da0f41f94054.jpg";

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

// 削除後の戻り先。ItemRow が必須で受けるので、テストでも毎回渡す
const SEARCH_STATE = { q: "", page: 1, sort: "updated" };

const renderRow = (
  item: Item,
  checkbox?: React.ReactNode,
  view: RowViewMode = "compact",
) =>
  renderToStaticMarkup(
    <ul>
      <ItemRow
        item={item}
        href={`/item/${item.itemNo}`}
        searchState={SEARCH_STATE}
        checkbox={checkbox}
        view={view}
      />
    </ul>,
  );

test("番号と要約をアイテム詳細へのリンクにする", () => {
  const html = renderRow(
    makeItem({ itemNo: "4951", memo: "BJT NPN 2SC2712-Y LY SMD" }),
  );
  expect(html).toContain('href="/item/4951"');
  expect(html).toContain("#4951");
  expect(html).toContain("BJT NPN 2SC2712-Y LY SMD");
});

test("タグを青いタグ検索リンクとして表示する", () => {
  const html = renderRow(
    makeItem({ itemNo: "4951", memo: "2SC2712 #bjt #npn", tags: ["bjt", "npn"] }),
  );
  expect(html).toContain('href="/?q=%23bjt"');
  expect(html).toContain('href="/?q=%23npn"');
  expect(html).toContain("text-blue-700");
});

test("タグのないアイテムはタグ行を出さない", () => {
  const html = renderRow(makeItem({ itemNo: "100", memo: "メモだけ", tags: [] }));
  expect(html).not.toContain("/?q=%23");
});

test("URL モードのアイテムは URL を表示する", () => {
  const html = renderRow(
    makeItem({ itemNo: "7", mode: "url", url: "https://example.com/x", memo: "" }),
  );
  expect(html).toContain("https://example.com/x");
});

test("checkbox スロットを渡すと行の中に描画する", () => {
  const html = renderRow(
    makeItem({ itemNo: "5" }),
    <input type="checkbox" name="itemNo" value="5" />,
  );
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('value="5"');
});

// 枠内どこでも押せる (stretched link)

test("枠全体をノートへの当たり判定にする", () => {
  // タイトルの文字の上だけでなく、枠のどこを押しても開く
  const html = renderRow(makeItem({ itemNo: "4951", memo: "BJT NPN" }));
  expect(html).toContain("after:absolute");
  expect(html).toContain("after:inset-0");
});

test("カード表示でも枠全体を当たり判定にする", () => {
  const html = renderRow(makeItem({ itemNo: "4951" }), undefined, "card");
  expect(html).toContain("after:inset-0");
});

test("当たり判定はリンクのまま広げる (中クリック・URL コピーを壊さない)", () => {
  // 行を <a> で包むとタグ (別の行き先) が入れ子になり HTML として不正。
  // ::after で広げるので href を持った本物のリンクが 1 つ残る
  const html = renderRow(makeItem({ itemNo: "4951" }));
  expect(html).toContain('href="/item/4951"');
});

test("タグは枠の当たり判定より前に出す (タグ検索へ行ける)", () => {
  // z-10 が無いと、タグを押してもノートが開いてしまう
  const html = renderRow(makeItem({ itemNo: "4951", memo: "#bjt", tags: ["bjt"] }));
  expect(html).toContain("relative z-10");
  expect(html).toContain('href="/?q=%23bjt"');
});

test("選択モードでは枠全体の当たり判定を敷かない", () => {
  // 膜がチェックボックスを覆って押せなくなるうえ、選んでいる最中に
  // 枠へ触れるたびノートへ飛んでしまう
  const html = renderRow(
    makeItem({ itemNo: "5" }),
    <input type="checkbox" name="itemNo" value="5" />,
  );
  expect(html).not.toContain("after:inset-0");
  expect(html).toContain('type="checkbox"');
});

// サムネ (docs/23-検索結果表示モード計画.md §2)

test("本文に画像があれば縮小版をサムネとして出す", () => {
  // ?thumb=1 でないと原寸 (数 MB) が 20 枚並ぶ
  const html = renderRow(
    makeItem({ memo: `写真\n![](/api/images/${IMAGE})` }),
  );
  // 末尾にキャッシュバスターの版 (&v=N) が付く (memoImages.ts の thumbUrl)。
  // HTML 属性なので & は &amp; にエスケープされる (ブラウザは & に戻す)
  expect(html).toContain(`src="/api/images/${IMAGE}?thumb=1&amp;v=`);
});

test("サムネは遅延読み込みし、届く前から場所を取る", () => {
  // width/height が無いと、画像が届いた瞬間に行が飛び跳ねる
  const html = renderRow(makeItem({ memo: `写真\n![](/api/images/${IMAGE})` }));
  expect(html).toContain('loading="lazy"');
  expect(html).toContain('width="40"');
});

test("カード表示のサムネは 5 行分の大きさで出す", () => {
  const html = renderRow(
    makeItem({ memo: `写真\n![](/api/images/${IMAGE})` }),
    undefined,
    "card",
  );
  expect(html).toContain('width="96"');
  expect(html).toContain("size-24");
});

test("サムネの alt は空 (すぐ左のタイトルが説明している)", () => {
  const html = renderRow(makeItem({ memo: `写真\n![代替](/api/images/${IMAGE})` }));
  expect(html).toContain('alt=""');
});

test("画像のないノートは img を出さない", () => {
  expect(renderRow(makeItem({ memo: "画像なし" }))).not.toContain("<img");
});

// 回路図サムネ (docs/68-一覧回路図サムネ計画.md §3)

const CIRCUIT_SVG = '<svg viewBox="0 0 10 10"><path d="M0 0h10"/></svg>'

const renderCircuitRow = (item: Item, view: RowViewMode = "compact") =>
  renderToStaticMarkup(
    <ul>
      <ItemRow
        item={item}
        href={`/item/${item.itemNo}`}
        searchState={SEARCH_STATE}
        view={view}
        circuitThumb={CIRCUIT_SVG}
      />
    </ul>,
  );

test("画像が無ければ回路図の SVG をサムネに出す", () => {
  const html = renderCircuitRow(makeItem({ memo: "RC 回路" }));
  expect(html).toContain("circuit-thumb");
  // SVG は文字列のまま埋め込まれる (dangerouslySetInnerHTML)
  expect(html).toContain('<path d="M0 0h10"/>');
  // 小表示は画像サムネと同じ 2 行分の枠
  expect(html).toContain("size-10");
});

test("カード表示の回路図サムネは 5 行分の枠で出す", () => {
  const html = renderCircuitRow(makeItem({ memo: "RC 回路" }), "card");
  expect(html).toContain("circuit-thumb");
  expect(html).toContain("size-24");
});

test("画像があれば画像を優先し、回路図サムネは出さない", () => {
  const html = renderCircuitRow(
    makeItem({ memo: `写真\n![](/api/images/${IMAGE})` }),
  );
  expect(html).toContain(`src="/api/images/${IMAGE}?thumb=1`);
  expect(html).not.toContain("circuit-thumb");
});

test("回路図サムネは装飾扱い (タイトルが説明する)", () => {
  const html = renderCircuitRow(makeItem({ memo: "RC 回路" }));
  expect(html).toContain('aria-hidden="true"');
});

test("SVG を渡さなければ回路図サムネの枠ごと出ない", () => {
  const html = renderRow(makeItem({ memo: "RC 回路" }));
  expect(html).not.toContain("circuit-thumb");
});

// ノート全体プレビュー (docs/71-一覧ノートプレビュー計画.md)

const NOTE_PREVIEW = <div data-testid="preview">縮小した本文</div>;

const renderPreviewRow = (item: Item, view: RowViewMode = "compact") =>
  renderToStaticMarkup(
    <ul>
      <ItemRow
        item={item}
        href={`/item/${item.itemNo}`}
        searchState={SEARCH_STATE}
        view={view}
        notePreview={NOTE_PREVIEW}
      />
    </ul>,
  );

test("画像も回路図も無ければノート全体プレビューを縮小枠で出す", () => {
  const html = renderPreviewRow(makeItem({ memo: "文字だけのノート" }));
  expect(html).toContain("note-preview");
  expect(html).toContain("縮小した本文");
  // 小表示は画像サムネと同じ 2 行分の枠。キャンバス 10rem × 0.25 = 2.5rem
  expect(html).toContain("size-10");
  expect(html).toContain("h-40 w-40");
  expect(html).toContain("scale-[0.25]");
});

test("カード表示のプレビューは 5 行分の枠で出す (20rem × 0.3 = 6rem)", () => {
  const html = renderPreviewRow(makeItem({ memo: "文字だけ" }), "card");
  expect(html).toContain("size-24");
  expect(html).toContain("h-80 w-80");
  expect(html).toContain("scale-[0.3]");
});

test("プレビューの枠は装飾扱いで、押す・フォーカスの経路を塞ぐ", () => {
  // 中身は本文の縮小描画 (リンク風の文字などが入る)。膜の下で押せる物を
  // 作らないよう aria-hidden + inert + pointer-events-none の三重で守る
  const html = renderPreviewRow(makeItem({ memo: "文字だけ" }));
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("inert");
  expect(html).toContain("pointer-events-none");
});

test("画像があれば画像を優先し、プレビューは出さない", () => {
  const html = renderPreviewRow(
    makeItem({ memo: `写真\n![](/api/images/${IMAGE})` }),
  );
  expect(html).toContain(`src="/api/images/${IMAGE}?thumb=1`);
  expect(html).not.toContain("note-preview");
});

test("回路図サムネがあれば回路図を優先し、プレビューは出さない", () => {
  const html = renderToStaticMarkup(
    <ul>
      <ItemRow
        item={makeItem({ memo: "RC 回路" })}
        href="/item/1"
        searchState={SEARCH_STATE}
        circuitThumb={CIRCUIT_SVG}
        notePreview={NOTE_PREVIEW}
      />
    </ul>,
  );
  expect(html).toContain("circuit-thumb");
  expect(html).not.toContain("note-preview");
});

test("notePreview を渡さなければ枠ごと出ない (今までどおり文字だけ)", () => {
  const html = renderRow(makeItem({ memo: "文字だけのノート" }));
  expect(html).not.toContain("note-preview");
});

// カード表示の本文プレビュー (docs/23-検索結果表示モード計画.md §3)

test("カード表示は本文プレビューを 3 行の枠で出す", () => {
  const html = renderRow(
    makeItem({ memo: "USB充電器\n#usb\n出力は 5V 3A" }),
    undefined,
    "card",
  );
  expect(html).toContain("出力は 5V 3A");
  // 行数は CSS が決める (Markdown の 1 行は折り返して 2 行にもなる)
  expect(html).toContain("line-clamp-3");
});

test("小表示は本文プレビューを出さない (2 行に収める)", () => {
  const html = renderRow(
    makeItem({ memo: "USB充電器\n#usb\n出力は 5V 3A" }),
    undefined,
    "compact",
  );
  expect(html).toContain("USB充電器");
  expect(html).not.toContain("出力は 5V 3A");
});

test("URL モードのノートは本文もサムネも持たない", () => {
  const html = renderRow(
    makeItem({ mode: "url", url: "https://example.com/x", memo: "" }),
    undefined,
    "card",
  );
  expect(html).toContain("https://example.com/x");
  expect(html).not.toContain("<img");
});

// スワイプ削除 (docs/43-スワイプ削除計画.md §7)

const noop = () => {};

const renderSwipeRow = (item: Item, view: RowViewMode = "compact") =>
  renderToStaticMarkup(
    <ul>
      <ItemRow
        item={item}
        href={`/item/${item.itemNo}`}
        searchState={SEARCH_STATE}
        view={view}
        swipeTrashAction={noop}
        swipeOpen={false}
        onSwipeOpenChange={noop}
      />
    </ul>,
  );

test("小表示でスワイプ有効なら削除ボタンを背面に持つ", () => {
  const html = renderSwipeRow(makeItem({ itemNo: "42" }));
  expect(html).toContain("削除");
  expect(html).toContain('aria-label="#42 を削除"');
});

test("スワイプ props を渡さなければ削除ボタンは出ない", () => {
  const html = renderRow(makeItem({ itemNo: "42" }));
  expect(html).not.toContain('aria-label="#42 を削除"');
});

test("選択モード (checkbox) ではスワイプを有効にしない", () => {
  const html = renderToStaticMarkup(
    <ul>
      <ItemRow
        item={makeItem({ itemNo: "42" })}
        href="/item/42"
        searchState={SEARCH_STATE}
        checkbox={<input type="checkbox" name="itemNo" value="42" />}
        swipeTrashAction={noop}
        swipeOpen={false}
        onSwipeOpenChange={noop}
      />
    </ul>,
  );
  expect(html).not.toContain('aria-label="#42 を削除"');
  expect(html).toContain('type="checkbox"');
});

test("カード表示でもスワイプ有効なら削除ボタンを持つ", () => {
  const html = renderSwipeRow(makeItem({ itemNo: "42" }), "card");
  expect(html).toContain('aria-label="#42 を削除"');
});

test("カードのスワイプ行は枠 (rounded border) を残す", () => {
  // 枠クラスは ItemRow が持って渡す。SwipeToTrashRow の li に乗る (docs/43 §9-2)
  const html = renderSwipeRow(makeItem({ itemNo: "42" }), "card");
  expect(html).toContain("rounded");
  expect(html).toContain("border-gray-200");
});

test("カードでも選択モードならスワイプを有効にしない", () => {
  const html = renderToStaticMarkup(
    <ul>
      <ItemRow
        item={makeItem({ itemNo: "42" })}
        href="/item/42"
        searchState={SEARCH_STATE}
        view="card"
        checkbox={<input type="checkbox" name="itemNo" value="42" />}
        swipeTrashAction={noop}
        swipeOpen={false}
        onSwipeOpenChange={noop}
      />
    </ul>,
  );
  expect(html).not.toContain('aria-label="#42 を削除"');
  expect(html).toContain('type="checkbox"');
  // 枠は今までどおり残る
  expect(html).toContain("rounded");
});

// 見出しが空でも文字を置く。**当たり判定のため** — 見出しのリンクは
// stretched link の基準なので、中身が空だと箱ごと高さ 0 になり、行のどこを
// 押してもノートが開かなくなる (画像だけのノート、ゴミ箱の空ノート)
test("見出しが空のノートでも代わりの文字を置く", () => {
  const html = renderRow(makeItem({ itemNo: "42", memo: "" }));
  expect(html).toContain("(空のノート)");
});

// 補助行 (ゴミ箱の削除日時と復元 / 永久削除)。膜の下に居るとボタンを押しても
// ノートが開いてしまうので、必ず relative z-10 で包んで出す
test("footer は stretched link の膜より前に出す", () => {
  const html = renderToStaticMarkup(
    <ul>
      <ItemRow
        item={makeItem({ itemNo: "42" })}
        href="/item/42"
        footer={<button type="button">復元</button>}
      />
    </ul>,
  );
  expect(html).toContain("復元");
  expect(html).toContain("relative z-10");
});

// 数式入りタイトル/プレビュー (docs/69-一覧数式計画.md)。
// HTML はサーバ (mathText.ts) が KaTeX+エスケープ済みで降ろす前提

const MATH_HTML = '<span class="katex">E=100</span>';

test("mathTitle があればタイトルを KaTeX の HTML で出す", () => {
  const html = renderToStaticMarkup(
    <ul>
      <ItemRow
        item={makeItem({ memo: "$E=100$ の回路" })}
        href="/item/1"
        searchState={SEARCH_STATE}
        mathTitle={MATH_HTML}
      />
    </ul>,
  );
  expect(html).toContain('class="katex"');
  expect(html).not.toContain("$E=100$");
});

test("mathPreview があればカードの本文プレビューを KaTeX の HTML で出す", () => {
  const html = renderToStaticMarkup(
    <ul>
      <ItemRow
        item={makeItem({ memo: "タイトル\n定常状態では $I=E/R$ になる" })}
        href="/item/1"
        searchState={SEARCH_STATE}
        view="card"
        mathPreview={MATH_HTML}
      />
    </ul>,
  );
  expect(html).toContain('class="katex"');
  expect(html).not.toContain("$I=E/R$");
});

test("math props が無ければ今までどおりプレーンテキスト", () => {
  const html = renderRow(makeItem({ memo: "$E=100$ の回路" }));
  expect(html).toContain("$E=100$ の回路");
  expect(html).not.toContain("katex");
});
