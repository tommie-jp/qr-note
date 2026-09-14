import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { MarkdownView } from "./MarkdownView";
import { ZoomableImage } from "./ZoomableImage";

// ZoomableImage は回転確定後の router.refresh() のために useRouter を呼ぶ。
// renderToStaticMarkup には App Router のコンテキストが無く useRouter が
// 投げるので、ここだけ差し替える (描画テストで refresh は呼ばれない)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

test("画像をクリック拡大用の button でラップする", () => {
  const html = renderToStaticMarkup(
    <ZoomableImage src="/api/images/a.png" alt="スクショ" width={200} />,
  );
  expect(html).toContain('<button type="button"');
  expect(html).toContain("cursor-zoom-in");
  expect(html).toContain('src="/api/images/a.png"');
  expect(html).toContain('alt="スクショ"');
  expect(html).toContain('width="200"');
});

test("初期状態では拡大オーバーレイを表示しない", () => {
  const html = renderToStaticMarkup(<ZoomableImage src="/api/images/a.png" />);
  expect(html).not.toContain("fixed inset-0");
});

test("MarkdownView の画像はクリック拡大に対応する", () => {
  const html = renderToStaticMarkup(
    <MarkdownView markdown="![スクショ|200](/api/images/a.png)" />,
  );
  expect(html).toContain("cursor-zoom-in");
  expect(html).toContain('width="200"');
  expect(html).toContain('alt="スクショ"');
});

test("allowRotate は img へ漏らさない (DOM 属性ではない)", () => {
  // allowRotate は独自 prop。<img> にそのまま撒くと React が警告を出すので、
  // 分割代入で取り除いていることを確かめる (初回描画は閉じているので回転
  // ボタンは出ない。オーバーレイはクリックで開くため静的描画には現れない)
  const html = renderToStaticMarkup(
    <ZoomableImage src="/api/images/a.png" alt="x" allowRotate />,
  );
  expect(html).not.toContain("allowRotate");
  expect(html).not.toContain("allowrotate");
});

test("MarkdownView に allowRotate を渡しても img 属性へ漏れない", () => {
  const html = renderToStaticMarkup(
    <MarkdownView markdown="![](/api/images/a.png)" allowRotate />,
  );
  expect(html).not.toContain("allowrotate");
});
