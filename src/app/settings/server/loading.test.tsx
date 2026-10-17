import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import Loading from "./loading";

test("ページの見出しと「お待ちください」を出す (読み上げにも状態を伝える)", () => {
  // Act
  const html = renderToStaticMarkup(<Loading />);

  // Assert
  expect(html).toContain("<h1");
  expect(html).toContain('role="status"');
  expect(html).toContain("サーバー情報を取得しています");
  expect(html).toContain("お待ちください");
  expect(html).toContain("animate-spin");
});

test("画面を覆わない (ダイアログにしない)", () => {
  // Act
  const html = renderToStaticMarkup(<Loading />);

  // Assert
  expect(html).not.toContain("fixed");
  expect(html).not.toContain('role="dialog"');
});
