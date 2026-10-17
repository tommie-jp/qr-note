import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ImageFitScope } from "./ImageFitScope";
import { ImageFitToggle } from "./ImageFitToggle";
import { NoteBody } from "./NoteBody";

// ZoomableImage は useRouter を呼ぶ (ZoomableImage.test.tsx と同じ差し替え)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

// サーバ描画は端末の設定を知らないので、必ず既定 (全体を表示) で描く
test("ImageFitScope はサーバ描画では全体表示の印を立てる", () => {
  const html = renderToStaticMarkup(
    <ImageFitScope>
      <p>本文</p>
    </ImageFitScope>,
  );
  expect(html).toContain('data-img-fit="page"');
  expect(html).toContain("<p>本文</p>");
});

test("ImageFitToggle はいまの状態 (全体) を名前に出す", () => {
  const html = renderToStaticMarkup(<ImageFitToggle />);
  expect(html).toContain('aria-label="画像は全体を表示"');
});

// CSS が「ノート本文の中の画像」だけを狙えるように、本文の器に印を付ける。
// 一覧のカードのプレビュー (NotePreviewThumb) は NoteBody を通らないので縮まない
test("NoteBody は本文の器に印を付け、画像に縮める対象の印を付ける", () => {
  const html = renderToStaticMarkup(
    <NoteBody memo={"![絵](/api/images/a.png)"} />,
  );
  expect(html).toContain("data-note-body");
  expect(html).toContain("data-zoomable");
});
