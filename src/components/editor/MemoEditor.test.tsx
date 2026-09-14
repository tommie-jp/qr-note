import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MemoEditor } from "./MemoEditor";

// CodeMirror 本体 (MemoEditorInner) は ssr: false の dynamic import なので、
// ここでは読み込まれない。MemoEditor が自前で描く hidden input と
// 書誌・商品情報取得の状況表示だけを見る

// base (この本文が載っている版) は必須。既定はテスト用の適当な版
const render = (props: Partial<Parameters<typeof MemoEditor>[0]> & { defaultValue: string }) =>
  renderToStaticMarkup(<MemoEditor base="1787000000123" {...props} />);

test("本文は hidden input に入る (フォームの送信値)", () => {
  const html = render({ defaultValue: "本文" });
  expect(html).toContain('name="memo"');
  expect(html).toContain('value="本文"');
});

test("ISBN を渡すと初手から「取得中」を出す", () => {
  // 実機で数秒かかることがあり、無表示だと取得失敗と見分けられない。
  // effect (取得開始) より前の最初の描画から出す
  const html = render({
    defaultValue: "\n\n#9784873115658 #book",
    prefill: { kind: "book", code: "9784873115658" },
  });
  expect(html).toContain("書籍情報を取得中");
  expect(html).toContain('aria-busy="true"');
});

test("JAN を渡すと文言が「商品情報」になる", () => {
  // 書籍と同じ導線で商品情報を引く (docs/14-JAN商品情報取得計画.md §2)。
  // 「書籍情報」と出すと本を探しているように読める
  const html = render({
    defaultValue: "\n\n#4901777018686",
    prefill: { kind: "product", code: "4901777018686" },
  });
  expect(html).toContain("商品情報を取得中");
  expect(html).toContain('aria-busy="true"');
});

test("prefill が無ければ状況表示そのものを出さない", () => {
  // 既存ノートの編集や取得対象外のコード。関係のない行を増やさない
  const html = render({ defaultValue: "既存の本文" });
  expect(html).not.toContain("書籍情報");
  expect(html).not.toContain("商品情報");
  expect(html).not.toContain("aria-busy");
});

test("基点は本文と同じ hidden input の並びで送る", () => {
  // 本文と対で持つのが要点 (docs/87-編集競合対策計画.md §2-2)。
  // フォーム側の hidden に置くと、同じ画面のチェック操作で基点だけが
  // 新しくなり、古い本文の保存が検査を素通りしてしまう
  const html = render({ defaultValue: "本文", base: "1787000000123" });

  expect(html).toContain('name="base"');
  expect(html).toContain('value="1787000000123"');
});

test("未登録のノートの基点は new (これから作る)", () => {
  const html = render({ defaultValue: "", base: "new" });

  expect(html).toContain('name="base"');
  expect(html).toContain('value="new"');
});

test("初期描画では上書きの印 (checkpoint) を送らない", () => {
  // 「このまま上書き」を選んだ送信だけが立てる一発の印。残ると
  // 普通の保存が自分の直前版を conflict として履歴に刻んでしまう
  const html = render({ defaultValue: "本文" });

  expect(html).not.toContain('name="checkpoint"');
});
