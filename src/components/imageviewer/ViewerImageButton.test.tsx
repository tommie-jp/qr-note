import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Item } from "@/generated/prisma/client";
import { ImageMasonry } from "../item/ImageMasonry";
import { PaneModeProvider } from "../panes/PaneModeProvider";
import { ImageViewerProvider } from "./ImageViewerProvider";
import { ViewerImageButton } from "./ViewerImageButton";

// 押したときの動き (覆い / ペイン・前後送り) はブラウザ側 (e2e/image-viewer.spec.ts)。
// ここでは「どこが釦になり、どこがノートへのリンクのままか」を静的に見る
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ back: () => {}, refresh: () => {} }),
}));

const IMAGE = "0190a0a0-0000-7000-8000-000000000001.jpg";
const target = { itemId: "n1", name: IMAGE, href: "/item/n1?q=x" };

test("provider の外では中身だけを描く (押せばノートのリンクが開く)", () => {
  const html = renderToStaticMarkup(
    <ViewerImageButton target={target}>
      <span>画像</span>
    </ViewerImageButton>,
  );
  expect(html).not.toContain("<button");
  expect(html).not.toContain("data-viewer-image");
});

test("provider の中では前後送りの目印つきの釦になる", () => {
  const html = renderToStaticMarkup(
    <PaneModeProvider mode="3">
      <ImageViewerProvider>
        <ViewerImageButton target={target}>
          <span>画像</span>
        </ViewerImageButton>
      </ImageViewerProvider>
    </PaneModeProvider>,
  );
  expect(html).toContain(`data-viewer-image="${IMAGE}"`);
  expect(html).toContain('data-viewer-item="n1"');
  expect(html).toContain('data-viewer-href="/item/n1?q=x"');
  expect(html).toContain('aria-label="画像を大きく表示"');
  // 膜 (stretched link の ::after) の上に出す
  expect(html).toContain("relative z-10");
});

test("画像タイルの画像はノートへのリンクの外に置く (a の中に button を入れない)", () => {
  const item = {
    itemId: "n1",
    memo: `# 題\n\n![](/api/images/${IMAGE})`,
    tags: [],
  } as unknown as Item;
  const html = renderToStaticMarkup(
    <PaneModeProvider mode="3">
      <ImageViewerProvider>
        <ImageMasonry items={[item]} itemHref={(id) => `/item/${id}`} />
      </ImageViewerProvider>
    </PaneModeProvider>,
  );
  const anchor = html.slice(html.indexOf("<a "), html.indexOf("</a>"));
  expect(anchor).not.toContain("<button");
  expect(anchor).not.toContain("<img");
  expect(html).toContain(`data-viewer-image="${IMAGE}"`);
});
