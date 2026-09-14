import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PASSKEY_SETTINGS_PATH } from "@/lib/authPaths";
import { SECRET_SETTINGS_PATH } from "@/lib/secret/secrets";
import { AppHeaderMenu } from "./AppHeaderMenu";

// HeaderMenu は閉じている間は項目を描かない (HeaderMenu.test.tsx)。ここでは
// AppHeaderMenu が HeaderMenu に渡す children (= 開いたときに並ぶ項目) を
// 取り出して静的描画し、ログイン状態・デモごとの出し分けを見る
const renderItems = (
  overrides: Partial<Parameters<typeof AppHeaderMenu>[0]> = {},
): string => {
  const menu = AppHeaderMenu({
    bgClass: "bg-white/95",
    user: "tommie",
    isDemo: false,
    rowTintId: "blue",
    siteUrl: "https://qr.example.jp",
    siteQrDataUrl: "data:image/png;base64,AA",
    ...overrides,
  });
  const { children } = menu.props as { children: React.ReactNode };
  return renderToStaticMarkup(<>{children}</>);
};

const SETTINGS_LINKS = [
  'href="/logs"',
  `href="${PASSKEY_SETTINGS_PATH}"`,
  `href="${SECRET_SETTINGS_PATH}"`,
  'href="/settings/import"',
  'href="/settings/history"',
];

test("誰にでも QR・GitHub・クレジット・テキストサイズを出す", () => {
  // Arrange / Act
  const outputs = [
    renderItems(),
    renderItems({ user: null }),
    renderItems({ isDemo: true }),
  ];

  // Assert
  for (const html of outputs) {
    expect(html).toContain("QR コード");
    expect(html).toContain('href="https://github.com/tommie-jp/qr-note"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('aria-label="大きく"');
  }
});

test("ログイン中の非デモは設定系・行の色・ログアウトを出す", () => {
  // Arrange / Act
  const html = renderItems();

  // Assert
  for (const link of SETTINGS_LINKS) {
    expect(html).toContain(link);
  }
  expect(html).toContain('aria-label="選択中の行の色"');
  expect(html).toContain("デバッグ");
  expect(html).toContain("ログアウト");
  expect(html).not.toContain("パスワードでログイン");
});

test("未ログインはログインの 2 手段だけを出し、設定系もログアウトも出さない", () => {
  // Arrange / Act
  const html = renderItems({ user: null });

  // Assert
  expect(html).toContain("パスキーでログイン");
  expect(html).toContain("パスワードでログイン");
  for (const link of SETTINGS_LINKS) {
    expect(html).not.toContain(link);
  }
  expect(html).not.toContain('aria-label="選択中の行の色"');
  expect(html).not.toContain("デバッグ");
  expect(html).not.toContain("ログアウト");
});

test("デモは設定系と行の色を伏せ、デバッグとログアウトは残す", () => {
  // Arrange / Act
  const html = renderItems({ isDemo: true });

  // Assert
  for (const link of SETTINGS_LINKS) {
    expect(html).not.toContain(link);
  }
  expect(html).not.toContain('aria-label="選択中の行の色"');
  expect(html).toContain("デバッグ");
  expect(html).toContain("ログアウト");
});
