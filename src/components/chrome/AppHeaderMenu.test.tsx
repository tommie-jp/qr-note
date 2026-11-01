import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { PASSKEY_SETTINGS_PATH } from "@/lib/auth/paths";
import { SECRET_SETTINGS_PATH } from "@/lib/secret/secrets";
import { AppHeaderMenu } from "./AppHeaderMenu";

// HeaderMenu は閉じている間は項目を描かない (components/chrome/HeaderMenu.test.tsx)。ここでは
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
    photoMetaMode: "strip",
    siteUrl: "https://qr.example.jp",
    siteQrDataUrl: "data:image/png;base64,AA",
    ...overrides,
  });
  const { children } = menu.props as { children: React.ReactNode };
  return renderToStaticMarkup(<>{children}</>);
};

const SETTINGS_LINKS = [
  `href="${PASSKEY_SETTINGS_PATH}"`,
  `href="${SECRET_SETTINGS_PATH}"`,
  'href="/settings/import"',
];

// 管理者 (env ADMIN_USER と一致) にだけ出す運用系 (2026-11 の監査 M-5)
const ADMIN_LINKS = ['href="/logs"', 'href="/settings/history"', 'href="/settings/server"'];

test("運用系 (ログ・履歴取り込み・サーバー情報) は管理者にだけ出す", () => {
  // Arrange
  vi.stubEnv("ADMIN_USER", "tommie");
  const admin = renderItems();
  vi.stubEnv("ADMIN_USER", "someone-else");
  const member = renderItems();
  vi.unstubAllEnvs();

  // Assert
  for (const link of ADMIN_LINKS) {
    expect(admin).toContain(link);
    expect(member).not.toContain(link);
  }
});

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
  expect(html).toContain('aria-label="写真の撮影情報 (EXIF)"');
  expect(html).toContain("デバッグ");
  expect(html).toContain("ログアウト");
  expect(html).not.toContain("パスワードでログイン");
});

// どちらも「他人に何が見えるか」の設定なので、並べて探せるようにする
// (docs/113-写真の撮影情報削除計画.md §4)
test("写真の撮影情報はシークレットの直後に置く", () => {
  const html = renderItems();

  const secret = html.indexOf(`href="${SECRET_SETTINGS_PATH}"`);
  const photo = html.indexOf('aria-label="写真の撮影情報 (EXIF)"');
  const imports = html.indexOf('href="/settings/import"');
  expect(secret).toBeGreaterThan(-1);
  expect(photo).toBeGreaterThan(secret);
  expect(imports).toBeGreaterThan(photo);
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
  expect(html).not.toContain("写真の撮影情報");
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
  // デモは共有アカウント。1 人が「残す」にすると全員の写真に効く
  expect(html).not.toContain("写真の撮影情報");
  expect(html).toContain("デバッグ");
  expect(html).toContain("ログアウト");
});
