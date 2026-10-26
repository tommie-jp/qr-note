import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { ClipboardSlotMeta } from "@/lib/clipboard/slot";
import { SlotPreview } from "./SlotPreview";

// 見本の描き分け (docs/115 §1-5)。jsdom が無いので描画だけを固定する
const AT = "2026-10-26T06:00:00.000Z";
const render = (slot: ClipboardSlotMeta) => renderToStaticMarkup(<SlotPreview slot={slot} />);

test("画像は見本の絵を出す。URL に版を付けて古い絵を掴まない", () => {
  const html = render({ kind: "image", bytes: 1, updatedAt: AT, mime: "image/png", hasThumb: true });

  expect(html).toMatch(/<img[^>]*src="\/api\/clipboard\/thumb\?v=2026-10-26T06%3A00%3A00\.000Z"/);
  expect(html).toContain("max-h-40");
  expect(html).toContain('alt="サーバのクリップボードの見本"');
});

test("動画の絵には再生の印を重ねる", () => {
  const html = render({ kind: "video", bytes: 1, updatedAt: AT, mime: "video/mp4", hasThumb: true });

  expect(html).toContain("<img");
  expect(html).toContain('<circle cx="12" cy="12" r="11"');
});

test("PDF の絵には PDF の札を重ねる", () => {
  const html = render({ kind: "pdf", bytes: 1, updatedAt: AT, mime: "application/pdf", hasThumb: true });

  expect(html).toContain("<img");
  expect(html).toContain(">PDF<");
});

test("文字は先頭の抜粋", () => {
  const html = render({ kind: "text", bytes: 1, updatedAt: AT, text: "1\n2\n3\n4\n5" });

  expect(html).toContain("1\n2\n3\n4…");
  expect(html).not.toContain("<img");
});

test("テキストファイルは等幅の抜粋と、拡張子の札", () => {
  const html = render({
    kind: "textfile",
    bytes: 2048,
    updatedAt: AT,
    mime: "text/csv; charset=utf-8",
    name: "成績.csv",
    preview: "名前,点",
  });

  expect(html).toContain("font-mono");
  expect(html).toContain("名前,点");
  expect(html).toContain(">CSV<");
});

test("Office は拡張子の札・名前・大きさ。抜粋があれば下に出す", () => {
  const html = render({
    kind: "file",
    bytes: 2.5 * 1024 * 1024,
    updatedAt: AT,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    name: "議事録.docx",
    preview: "出席: 山田",
  });

  expect(html).toContain(">DOCX<");
  expect(html).toContain("議事録.docx");
  expect(html).toContain("2.5MB");
  expect(html).toContain("出席: 山田");
  // Word 系は青
  expect(html).toContain("bg-blue-600");
});

test.each([
  ["a.xlsx", "bg-green-600"],
  ["a.pptx", "bg-orange-500"],
  ["a.zip", "bg-gray-500"],
])("札の色は系統で分ける: %s", (name, color) => {
  expect(
    render({ kind: "file", bytes: 1, updatedAt: AT, mime: "application/octet-stream", name }),
  ).toContain(color);
});

// 動画の絵がまだ届いていない (貼っている途中・描けない動画) ときは札
test("絵の無い動画は札", () => {
  const html = render({ kind: "video", bytes: 1, updatedAt: AT, mime: "video/mp4", name: "clip.mov" });

  expect(html).not.toContain("<img");
  expect(html).toContain(">MOV<");
});

test("名前の無いファイルは mime から拡張子の札", () => {
  expect(render({ kind: "image", bytes: 1, updatedAt: AT, mime: "image/jpeg" })).toContain(">JPG<");
});

// 押せる物に見せない (受け取りは上の行)
test("見本はボタンにもリンクにもしない", () => {
  const html = render({ kind: "image", bytes: 1, updatedAt: AT, mime: "image/png", hasThumb: true });

  expect(html).not.toContain("<button");
  expect(html).not.toContain("<a ");
});
