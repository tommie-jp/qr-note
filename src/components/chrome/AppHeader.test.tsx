import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import pkg from "../../../package.json";
import { AppHeader } from "./AppHeader";

// 全ページ共通のヘッダーの帯。サーバコンポーネントだが props だけで描くので
// そのまま静的描画して中身を見る (メニューの項目は AppHeaderMenu.test.tsx)
const noop = () => {};

const render = (
  overrides: Partial<Parameters<typeof AppHeader>[0]> = {},
): string =>
  renderToStaticMarkup(
    <AppHeader
      user="tommie"
      isProd={true}
      isDemo={false}
      paneMode="2"
      paneModeAction={noop}
      rowTintId="blue"
      siteUrl="https://qr.example.jp"
      siteQrDataUrl="data:image/png;base64,AA"
      {...overrides}
    />,
  );

test("ログイン中はユーザー名とペイン構成ボタンを右端に出す", () => {
  // Arrange / Act
  const html = render();

  // Assert
  expect(html).toContain('title="tommie でログイン中"');
  expect(html).toContain('name="panes"');
  expect(html).toContain("ml-auto");
});

test("未ログインでも帯 (ホーム・版・メニュー) は出し、右端の一群は出さない", () => {
  // Arrange / Act
  const html = render({ user: null });

  // Assert
  expect(html).toContain("<header");
  expect(html).toContain('href="/"');
  expect(html).toContain(`v${pkg.version}`);
  expect(html).toContain('aria-label="メニュー"');
  expect(html).not.toContain("でログイン中");
  expect(html).not.toContain('name="panes"');
});

test("本番は白い帯で LOCAL の目印を出さない", () => {
  // Arrange / Act
  const html = render({ isProd: true });

  // Assert
  expect(html).toContain("bg-white/95");
  expect(html).toContain("border-gray-200");
  expect(html).not.toContain(">LOCAL<");
});

test("非本番はピンクの帯に LOCAL の目印を出し、メニューのボタンも同じ地色にする", () => {
  // Arrange / Act
  const html = render({ isProd: false });

  // Assert
  expect(html).toContain(">LOCAL<");
  expect(html).toContain("border-pink-300");
  // 帯と開閉ボタンの 2 か所が同じ地色 (横スクロールで文字が透けないように)
  expect(html.match(/bg-pink-100\/95/g)).toHaveLength(2);
});

test("デモは DEMO の目印を出す (LOCAL とは独立)", () => {
  // Arrange / Act
  const demoProd = render({ isDemo: true, isProd: true });
  const plain = render({ isDemo: false });

  // Assert
  expect(demoProd).toContain(">DEMO<");
  expect(demoProd).not.toContain(">LOCAL<");
  expect(plain).not.toContain(">DEMO<");
});

test("デモでもログイン中ならユーザー名は出す", () => {
  // Arrange / Act
  const html = render({ isDemo: true, user: "guest" });

  // Assert
  expect(html).toContain('title="guest でログイン中"');
});
