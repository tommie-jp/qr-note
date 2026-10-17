import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MenuLinkPendingNotice, PendingMenuLink } from "./PendingMenuLink";

// 操作の土台 (jsdom) は持たないので (HeaderMenu.test.tsx の注)、pending の
// 見た目は表示だけの部品を pending を直に渡して描いて確かめる。
// 押してから pending が立つことは useLinkStatus (Next) の責務

test("待っていない間は「処理中です」を出さない", () => {
  // Arrange / Act
  const html = renderToStaticMarkup(<MenuLinkPendingNotice pending={false} />);

  // Assert
  expect(html).toBe("");
});

test("遷移待ちの間は「処理中です」とスピナーを状態として読み上げさせる", () => {
  // Arrange / Act
  const html = renderToStaticMarkup(<MenuLinkPendingNotice pending />);

  // Assert
  expect(html).toContain('role="status"');
  expect(html).toContain("処理中です…");
  expect(html).toContain("animate-spin");
});

test("リンクとしては href とラベルをそのまま出す", () => {
  // Arrange / Act
  const html = renderToStaticMarkup(
    <PendingMenuLink href="/settings/server" className="row">
      サーバー情報
    </PendingMenuLink>,
  );

  // Assert
  expect(html).toContain('href="/settings/server"');
  expect(html).toContain('class="row"');
  expect(html).toContain("サーバー情報");
  expect(html).not.toContain("処理中です");
});
