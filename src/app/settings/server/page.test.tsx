import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ServerInfo } from "@/lib/diag/types";
import ServerInfoPage from "./page";

// 門番 (requireAdminPage) と収集 (collectServerInfo) は差し替える。
// 門番の判定そのものは lib/auth/pageGuard.test.ts、収集は lib/diag/*.test.ts。
// ここは「集めた値が画面に出るか」「失敗した節が失敗として出るか」だけを見る
const mocks = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  collectServerInfo: vi.fn(),
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
  expect(html.indexOf("ヘルスチェック")).toBeLessThan(html.indexOf("ホスト"));
});

test("失敗した節は「取得できませんでした」と理由を出す (空欄にしない)", async () => {
  // Act
  const html = renderToStaticMarkup(await ServerInfoPage());

  // Assert
  expect(html).toContain("取得できませんでした");
  expect(html).toContain("connect ECONNREFUSED");
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
