import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  clearLogBuffer,
  installConsoleCapture,
  pushBrowserLogs,
  uninstallConsoleCapture,
} from "@/lib/logBuffer";
import LogsPage from "./page";

// バッファに実際に積んで、ページに出ることを見る (docs/21-ログ表示計画.md §5)。
// ログインの検査はページには無い — proxy が門番 (publicPaths に無いパスは
// 既定で閉じる) なので、ここでは表示だけを見る

// PageTransition は React canary の ViewTransition を使い、テストの
// 静的レンダラ (renderToStaticMarkup) では描けない。見た目の遷移だけの
// 部品なので素通しにする
vi.mock("@/components/PageTransition", () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  installConsoleCapture();
});

afterEach(() => {
  uninstallConsoleCapture();
  clearLogBuffer();
  vi.restoreAllMocks();
});

test("控えた警告・エラーが新しい順に出る", () => {
  console.warn("RAKUTEN_APP_ID が未設定のため、楽天からは書影を取得しません");
  console.error("書影を保存できませんでした (isbn=9784873115658)");

  const html = renderToStaticMarkup(<LogsPage />);
  expect(html).toContain("RAKUTEN_APP_ID が未設定");
  expect(html).toContain("isbn=9784873115658");
  // 新しい順: error (後に積んだ) が先に出る
  expect(html.indexOf("書影を保存できませんでした")).toBeLessThan(
    html.indexOf("RAKUTEN_APP_ID"),
  );
  expect(html).toContain("error");
  expect(html).toContain("warn");
});

test("空のときは「壊れて出ない」と見分けの付く文言を出す", () => {
  const html = renderToStaticMarkup(<LogsPage />);
  expect(html).toContain("ログはありません");
  expect(html).toContain("まだ発生していません");
});

// --- コピー (docs/21-ログ表示計画.md §6) ---

// コピーする文字列そのものの検証は formatLogsForCopy.test.ts。ここは
// 「ボタンが出るか」「押せる状態か」だけを見る (prop は静的 HTML に出ない)。
//
// アイコンだけのボタンなので、名前は aria-label で探す — 文字が無い分、
// これが読み上げと自動テストの両方の手がかりになる
test("ログがあるならコピーボタンを押せる", () => {
  console.error("書影を保存できませんでした (isbn=9784873115658)");

  const html = renderToStaticMarkup(<LogsPage />);
  expect(html).toContain('aria-label="ログをコピー"');
  // 属性で見る ("disabled" だけだと Tailwind の disabled: クラスに当たる)
  expect(html).not.toContain('disabled=""');
});

test("ログが無いときはコピーを押せない", () => {
  const html = renderToStaticMarkup(<LogsPage />);
  expect(html).toContain('aria-label="ログをコピー"');
  expect(html).toContain('disabled=""');
});

test("クリアもアイコンで、名前を読み上げに残す", () => {
  const html = renderToStaticMarkup(<LogsPage />);
  expect(html).toContain('aria-label="ログをクリア"');
});

// --- ブラウザから届いたログ (docs/30-ブラウザログ計画.md §1) ---

test("ブラウザのログは端末の印を添えて出る", () => {
  pushBrowserLogs(
    [{ level: "error", text: "モデルを読み込めませんでした" }],
    "iPhone",
  );

  const html = renderToStaticMarkup(<LogsPage />);
  expect(html).toContain("モデルを読み込めませんでした");
  // サーバ由来と目で拾い分けられること
  expect(html).toContain("ブラウザ (iPhone)");
});

test("サーバとブラウザが混ざっても、それぞれの出所が分かる", () => {
  console.warn("RAKUTEN_APP_ID が未設定");
  pushBrowserLogs([{ level: "error", text: "埋め込みに失敗" }], "iPhone");

  const html = renderToStaticMarkup(<LogsPage />);
  expect(html).toContain("サーバ");
  expect(html).toContain("ブラウザ (iPhone)");
});
