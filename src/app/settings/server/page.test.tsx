import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as formatModule from "@/lib/diag/formatServerInfo";
import type { ServerInfo } from "@/lib/diag/types";
import ServerInfoPage from "./page";

// 門番 (requireAdminPage) と収集 (collectServerInfo) は差し替える。
// 門番の判定そのものは lib/auth/pageGuard.test.ts、収集は lib/diag/*.test.ts。
// ここは「集めた値が画面に出るか」「失敗した節が失敗として出るか」だけを見る
const mocks = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  collectServerInfo: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("@/lib/auth/pageGuard", () => ({
  requireAdminPage: mocks.requireAdminPage,
}));
vi.mock("@/lib/diag/serverInfo", () => ({
  collectServerInfo: mocks.collectServerInfo,
}));
vi.mock("@/components/chrome/PageTransition", () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => children,
}));

const INFO: ServerInfo = {
  collectedAt: new Date("2026-10-17T03:04:05Z"),
  overall: "warn",
  checks: [
    { name: "DB 応答", level: "ok", detail: "SELECT 1 に 12ms" },
    { name: "スワップ (ホスト)", level: "warn", detail: "使用 60%" },
  ],
  sections: [
    {
      id: "host",
      title: "ホスト",
      result: {
        kind: "ok",
        rows: [{ label: "OS", value: "Ubuntu 24.04.2 LTS" }],
      },
    },
    {
      id: "db",
      title: "DB",
      result: { kind: "failed", message: "connect ECONNREFUSED" },
    },
  ],
};

beforeEach(() => {
  mocks.requireAdminPage.mockReset();
  mocks.requireAdminPage.mockResolvedValue("tommie");
  mocks.collectServerInfo.mockReset();
  mocks.collectServerInfo.mockResolvedValue(INFO);
  mocks.headers.mockReset();
  mocks.headers.mockResolvedValue(
    new Headers({ "x-real-ip": "100.124.223.57", host: "qr.tommie.jp" }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("門番を通してから集め、判定 → 節 の順に出す", async () => {
  // Act
  const html = renderToStaticMarkup(await ServerInfoPage());

  // Assert
  expect(mocks.requireAdminPage).toHaveBeenCalledOnce();
  expect(html).toContain("ヘルスチェック");
  expect(html).toContain("注意");
  expect(html).toContain("SELECT 1 に 12ms");
  expect(html).toContain("Ubuntu 24.04.2 LTS");
  // 見出しで比べる (「この接続」節の「ホスト名」の行に当たらないように)
  expect(html.indexOf("ヘルスチェック")).toBeLessThan(
    html.indexOf(">ホスト</h2>"),
  );
});

test("失敗した節は「取得できませんでした」と理由を出す (空欄にしない)", async () => {
  // Act
  const html = renderToStaticMarkup(await ServerInfoPage());

  // Assert
  expect(html).toContain("取得できませんでした");
  expect(html).toContain("connect ECONNREFUSED");
});

test("この接続の経路を、ヘルスチェックより上に出す", async () => {
  // Act
  const html = renderToStaticMarkup(await ServerInfoPage());

  // Assert
  expect(html).toContain("この接続");
  expect(html).toContain("Tailscale 経由");
  expect(html).toContain("100.124.223.57");
  expect(html.indexOf("この接続")).toBeLessThan(html.indexOf("ヘルスチェック"));
});

test("公開側から来たときは、そうと分かる", async () => {
  // Arrange
  mocks.headers.mockResolvedValue(
    new Headers({ "x-real-ip": "203.0.113.7", host: "qr.tommie.jp" }),
  );

  // Act
  const html = renderToStaticMarkup(await ServerInfoPage());

  // Assert
  expect(html).toContain("インターネット (公開側)");
  expect(html).not.toContain("Tailscale 経由");
});

test("コピーの文面にも経路が入る", async () => {
  // Arrange: 文面はボタンの props にしか無いので、整形関数の出力を捕まえる
  const formatSpy = vi.spyOn(formatModule, "formatServerInfo");

  // Act
  renderToStaticMarkup(await ServerInfoPage());

  // Assert
  const text = formatSpy.mock.results[0]?.value as string;
  expect(text).toContain("## この接続");
  expect(text).toContain("経路: Tailscale 経由");
});

test("コピーボタンが名乗りつきで出る", async () => {
  // Act
  const html = renderToStaticMarkup(await ServerInfoPage());

  // Assert
  expect(html).toContain('aria-label="サーバー情報をコピー"');
});

test("門番が 404 を投げたら集めない", async () => {
  // Arrange
  const notFound = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  mocks.requireAdminPage.mockRejectedValue(notFound);

  // Act / Assert
  await expect(ServerInfoPage()).rejects.toBe(notFound);
  expect(mocks.collectServerInfo).not.toHaveBeenCalled();
});
