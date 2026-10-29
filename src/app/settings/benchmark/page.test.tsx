import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { BenchStatus } from "@/lib/diag/benchStatus";
import BenchmarkPage from "./page";

// 門番と状態の読み出しは差し替える (判定は pageGuard.test.ts、読み出しは
// benchStore.test.ts)。ここは「保存した結果が画面に出るか」だけを見る
const mocks = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  loadBenchStatus: vi.fn(),
}));

vi.mock("@/app/actions/benchmark", () => ({
  getBenchStatusAction: vi.fn(),
  startCpuBenchAction: vi.fn(),
  startServerBenchAction: vi.fn(),
}));
vi.mock("@/lib/auth/pageGuard", () => ({
  requireAdminPage: mocks.requireAdminPage,
}));
vi.mock("@/lib/diag/benchStatus", () => ({
  loadBenchStatus: mocks.loadBenchStatus,
}));
vi.mock("@/components/chrome/PageTransition", () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => children,
}));

const EMPTY: BenchStatus = {
  running: null,
  cpu: null,
  server: null,
  clients: [],
  profileAt: null,
  errors: [],
};

beforeEach(() => {
  mocks.requireAdminPage.mockReset();
  mocks.requireAdminPage.mockResolvedValue("tommie");
  mocks.loadBenchStatus.mockReset();
});

test("門番を通してから読み、未計測なら未計測と出す", async () => {
  mocks.loadBenchStatus.mockResolvedValue(EMPTY);

  const html = renderToStaticMarkup(await BenchmarkPage());

  expect(mocks.requireAdminPage).toHaveBeenCalledOnce();
  expect(html).toContain("サーバを計測");
  expect(html).toContain("この端末を計測");
  expect(html).toContain("未計測");
  expect(html).not.toContain("cpuprofile");
});

test("保存したサーバ・端末・プロファイルを出し、読めなかった理由も出す", async () => {
  mocks.loadBenchStatus.mockResolvedValue({
    ...EMPTY,
    cpu: "シングル 3620 MIPS",
    server: {
      version: 1,
      env: {
        cpuModel: "Intel Core Processor (Broadwell)",
        threads: 3,
        totalMemMB: 2048,
        nodeVersion: "v26.12.1",
        appVersion: "0.23.83",
        items: 1148,
        circuitItems: 583,
        measuredAt: "2026-10-29T05:00:00.000Z",
      },
      items: [
        {
          id: "parse:fixture",
          label: "回路の解析 (見本 5KB × 10)",
          medianMs: 61.2,
          scale: "10 件・50 図",
          phases: { 解析: 55 },
          fixed: true,
        },
      ],
      failed: [{ id: "thumb:fixture", message: "sharp missing" }],
    },
    clients: [
      {
        version: 1,
        device: "iPhone",
        line: "キャリア",
        panes: "2",
        width: "390x844",
        measuredAt: "2026-10-29T05:00:00.000Z",
        rows: [{ label: "回線", value: "RTT=60ms" }],
      },
    ],
    profileAt: "2026-10-29T05:00:00.000Z",
    errors: ["端末の計測の保存: 形が不正"],
  } satisfies BenchStatus);

  const html = renderToStaticMarkup(await BenchmarkPage());

  expect(html).toContain("Intel Core Processor (Broadwell)");
  expect(html).toContain("シングル 3620 MIPS");
  expect(html).toContain("回路の解析 (見本 5KB × 10)");
  expect(html).toContain("61.2ms");
  expect(html).toContain("thumb:fixture (sharp missing)");
  expect(html).toContain("iPhone / キャリア");
  expect(html).toContain("RTT=60ms");
  expect(html).toContain("/api/diag/profile");
  expect(html).toContain("端末の計測の保存: 形が不正");
});
