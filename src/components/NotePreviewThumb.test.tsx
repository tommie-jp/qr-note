import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { buildNotePreviews, NotePreviewThumb } from "./NotePreviewThumb";

const IMAGE = "0421547b-ee29-4613-a6d4-da0f41f94054.jpg";
const SECRET = "0421547b-ee29-4613-a6d4-da0f41f94054";

const render = (markdown: string) =>
  renderToStaticMarkup(<NotePreviewThumb markdown={markdown} />);

test("見出し・リスト・数式を本文と同じ規則で描く", () => {
  const html = render("# タイトル\n\n- 項目1\n\n$E=mc^2$");
  expect(html).toContain("<h1>タイトル</h1>");
  expect(html).toContain("<li>項目1</li>");
  expect(html).toContain('class="katex"');
});

// 行は stretched link の膜で包まれており、中に押せる物を置かない。
// リンク・ボタン・有効な input が 1 つでも出ると Tab の止まり先が増える

test("リンクは <a> にしない (見た目だけ残す)", () => {
  const html = render("[説明書](https://example.com/doc) と /item/5 への[内部](/item/5)");
  expect(html).not.toContain("<a");
  expect(html).not.toContain("href=");
  expect(html).toContain("説明書");
});

test("quiz フェンスもボタンではなくプレースホルダにする", () => {
  const html = render("```quiz\n問: 時定数は。\n1. $RC$\n正解: 1\n```");
  expect(html).not.toContain("<button");
  expect(html).toContain("fence-placeholder");
});

test("タスクリストは GFM 既定の disabled チェックボックスのまま", () => {
  const html = render("- [ ] 未着手\n- [x] 済み");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("disabled");
});

// mermaid はサーバで描画できない (docs/70 §Phase2 まではプレースホルダ)

test("mermaid フェンスはプレースホルダにする (描画中スピナーを出さない)", () => {
  const html = render("```mermaid\ngraph TD; A-->B;\n```");
  expect(html).toContain("fence-placeholder");
  expect(html).not.toContain("mermaid-diagram");
  expect(html).not.toContain("<code");
});

test("circuitikz フェンスもプレースホルダにする (未描画の図の受け皿)", () => {
  const html = render("```circuitikz\n\\draw (0,0) to[R] (2,0);\n```");
  expect(html).toContain("fence-placeholder");
  expect(html).not.toContain("<code");
});

test("普通のコードフェンスはコードのまま (コピーボタンは持たない)", () => {
  const html = render("```bash\nls -la\n```");
  expect(html).toContain("<code");
  expect(html).not.toContain("<button");
});

// シークレット (docs/51)。復号内容どころか解錠 UI ごと出さない

test("シークレットは伏せ字チップにする (SecretBlock を出さない)", () => {
  const html = render(`![APIキー](/api/secrets/${SECRET})`);
  expect(html).toContain("APIキー");
  expect(html).not.toContain("<button");
  expect(html).not.toContain(`/api/secrets/${SECRET}`);
});

// 添付 (docs/12/14)。押せるプレイヤーやビューアは開かない

test("内部画像は ?thumb=1 の縮小版で出す", () => {
  const html = render(`![](/api/images/${IMAGE})`);
  expect(html).toContain(`src="/api/images/${IMAGE}?thumb=1&amp;v=`);
  expect(html).toContain('loading="lazy"');
});

test("外部画像は取得しない (アイコンチップに畳む)", () => {
  const html = render("![外の図](https://example.com/big.png)");
  expect(html).not.toContain("https://example.com/big.png");
  expect(html).toContain("外の図");
});

test("音声・PDF はチップにする (プレイヤー・ビューアを開かない)", () => {
  const html = render(
    `![録音](/api/images/${SECRET}.mp3)\n\n![仕様書.pdf](/api/images/${SECRET}.pdf)`,
  );
  expect(html).not.toContain("<audio");
  expect(html).not.toContain("<button");
  expect(html).toContain("録音");
  expect(html).toContain("仕様書.pdf");
});

test("動画はチップにする (poster の無い動画で壊れた画像を出さない)", () => {
  // ?thumb=1 は poster の無い動画に 404 を返す。RowThumb は onError で
  // アイコンへ切り替えるが、サーバ描画のプレビューではそれができない
  const html = render(`![録画](/api/images/${SECRET}.mp4)`);
  expect(html).not.toContain("<img");
  expect(html).toContain("録画");
});

test("画像の幅記法 (alt|200) はチップのラベルから外す", () => {
  const html = render("![外の図|200](https://example.com/x.png)");
  expect(html).toContain("外の図");
  expect(html).not.toContain("|200");
});

// 動画も同じ記法で幅を指定できる (docs/73-動画幅指定計画.md)。一覧は実寸で
// 描かないので幅そのものは捨て、ラベルだけ残す
test("動画の幅記法もチップのラベルから外す", () => {
  const html = render(`![録画|300](/api/images/${SECRET}.mp4)`);
  expect(html).toContain("録画");
  expect(html).not.toContain("|300");
});

test("生の HTML (script) は出力しない (本文と同じサニタイズ)", () => {
  const html = render('<script>alert("x")</script>ほげ');
  expect(html).not.toContain("<script");
});

test("details は閉じたまま出す", () => {
  const html = render(":::details[長いログ]\n中身\n:::");
  expect(html).not.toContain("open");
});

// buildNotePreviews (対象の選別。優先順位の正本は ItemRow の thumb 分岐)

const item = (itemNo: string, memo: string, mode = "memo") => ({
  itemNo,
  memo,
  mode,
});

test("画像も回路図も無いノートだけプレビューを作る", () => {
  const previews = buildNotePreviews(
    [
      item("1", "文字だけのノート"),
      item("2", `写真\n![](/api/images/${IMAGE})`),
      item("3", "```circuitikz\n\\draw;\n```"),
      item("4", "", "url"),
      item("5", ""),
    ],
    { "3": ["<svg/>"] },
    "card",
  );
  expect(Object.keys(previews)).toEqual(["1"]);
});

test("回路図サムネが未描画のノートにはプレビューを作る (受け皿)", () => {
  const previews = buildNotePreviews(
    [item("3", "説明\n```circuitikz\n\\draw;\n```")],
    {},
    "card",
  );
  expect(Object.keys(previews)).toEqual(["3"]);
});

// 回路図の判定は ItemRow の分岐 (?.[0]) と同じ形にする。片方が「図あり」
// もう片方が「図なし」と読むと、顔が 1 つも出ない行ができる
test("回路図サムネの配列が空ならプレビューを作る", () => {
  const previews = buildNotePreviews([item("3", "説明")], { "3": [] }, "card");
  expect(Object.keys(previews)).toEqual(["3"]);
});

test("件数上限を超えた分は作らない (累積ページ対策)", () => {
  const items = Array.from({ length: 100 }, (_, i) => item(`${i}`, `ノート ${i}`));
  const previews = buildNotePreviews(items, {}, "card");
  expect(Object.keys(previews).length).toBe(60);
  expect(previews["0"]).toBeDefined();
  expect(previews["99"]).toBeUndefined();
});

// 表示モードごとの出し分け (buildMathTexts / loadCircuitThumbs と同じ作法)
test("画像モードはプレビューを作らない (行が無い)", () => {
  const previews = buildNotePreviews([item("1", "文字だけ")], {}, "image");
  expect(previews).toEqual({});
});
