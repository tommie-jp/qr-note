import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { VideoPlayer } from "./VideoPlayer";

// 本文の幅記法 (![録画|300]) は**上限**として効く (docs/73-動画幅指定計画.md §2)。
// <video> は既定で全幅に伸びる部品なので、指定を固定幅にすると画面より広い
// 指定で横スクロールが生える
test("幅を指定すると max-width になり既定の max-w-md を外す", () => {
  const html = renderToStaticMarkup(
    <VideoPlayer src="/api/images/a.mp4" label="録画" width={300} />,
  );
  expect(html).toContain("max-width:300px");
  expect(html).not.toContain("max-w-md");
  // 画面が狭ければ縮む (幅の上限だけを差し替える)
  expect(html).toContain("w-full");
});

test("幅の指定がなければ従来どおり max-w-md のまま", () => {
  const html = renderToStaticMarkup(
    <VideoPlayer src="/api/images/a.mp4" label="録画" />,
  );
  expect(html).toContain("max-w-md");
  expect(html).not.toContain("max-width");
});

test("poster に ?thumb=1 を渡す (幅指定があっても変わらない)", () => {
  const html = renderToStaticMarkup(
    <VideoPlayer src="/api/images/a.mp4" label="録画" width={300} />,
  );
  expect(html).toContain('poster="/api/images/a.mp4?thumb=1"');
  expect(html).toContain("playsInline");
});
