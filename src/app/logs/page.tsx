import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTransition } from "@/components/chrome/PageTransition";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { isDemoMode } from "@/lib/appEnv";
import { recentLogs, recentPerfLines } from "@/lib/logging/buffer";
import { isPerfLogEnabled } from "@/lib/logging/perfSwitch";
import { PerfToggleButton } from "./PerfToggleButton";
import { requireUser } from "@/lib/auth/session";
import { ClearLogsButton } from "./ClearLogsButton";
import { CopyTextButton } from "@/components/CopyTextButton";
import {
  formatLogsForCopy,
  formatPerfLinesForCopy,
  LOG_TIME_FORMAT,
} from "./formatLogsForCopy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ログ",
};

// ログの表示 (docs/21-ログ表示計画.md、docs/30-ブラウザログ計画.md)。
// 書影・書誌・商品情報の取得失敗はサーバの警告にしか出ず、画像検索や OCR の
// 失敗はブラウザの console にしか出ない。iPhone は Mac 無しでインスペクタを
// 繋げないため、どちらもスマホから原因に届くようにする。ログインは二重に
// 見る: proxy が楽観的な門番 (publicPaths に無いパスは既定で閉じる) で、
// ページでも requireUser() を重ねる (docs/18 §4。ログには URL や失敗の
// 中身が載るので、proxy だけを砦にしない)。
//
// 読み直しはブラウザの再読み込みで足りる (ポーリングはしない。docs/21 §4)。

const LEVEL_BADGE: Record<string, string> = {
  // info は診断イベント (logging/diagLog.ts)。失敗ではないので警告色にしない
  info: "bg-gray-100 text-gray-600",
  warn: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
};

// どこで起きたかを色でも分ける。サーバとブラウザが時刻順に混ざるので、
// 文字だけだと目で追うときに拾い分けられない
const SOURCE_BADGE: Record<string, string> = {
  server: "bg-gray-200 text-gray-700",
  browser: "bg-sky-100 text-sky-800",
};

interface LogsPageProps {
  // ?perf=1 で速度計測の行だけを出す (docs/119-速度計測ログ計画.md §1-3)
  searchParams?: Promise<{ perf?: string | string[] }>;
}

export default async function LogsPage({ searchParams }: LogsPageProps = {}) {
  // デモでは /logs を閉じる (docs/38-デモモード計画.md §4)。共有アカウントでは
  // 他の訪問者の操作痕 (URL・失敗) が見えてしまうため。導線も隠すが、
  // URL 直打ちに備えてページも 404 に倒す
  if (isDemoMode()) {
    notFound();
  }
  await requireUser();

  if ((await searchParams)?.perf === "1") {
    return <PerfLogs />;
  }

  const logs = recentLogs();

  return (
    <PageTransition>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">ログ</h1>
          <span className="flex items-baseline gap-1">
            <Link href="/logs?perf=1" className={ACTION_LINK_CLASS}>
              計測
            </Link>
            <Link href="/" transitionTypes={["nav-back"]} className={ACTION_LINK_CLASS}>
              検索へ
            </Link>
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <p className="text-gray-500">
            直近のログ (新しい順、サーバ・ブラウザ各 200 件)。warn/error
            は警告・エラー、info は診断イベント。サーバが再起動すると消えます。
          </p>
          {/* 調査は「コピーして手元で読む」→「消してから再現し直す」の順に
              なるので、コピーを先に置く */}
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <CopyTextButton text={formatLogsForCopy(logs)} subject="ログ" />
            <ClearLogsButton />
          </span>
        </div>
        {logs.length === 0 ? (
          // 「壊れて出ない」と見分けが付く文言にする (docs/21 §3)
          <p className="text-gray-500">
            ログはありません (起動後、警告・エラーはまだ発生していません)。
          </p>
        ) : (
          <ul className="space-y-2">
            {logs.map((log, i) => (
              <li
                key={`${log.at}-${i}`}
                className="rounded border border-gray-300 bg-white px-3 py-2"
              >
                <div className="mb-1 flex items-center gap-2 text-sm text-gray-500">
                  <span
                    className={`rounded px-1.5 py-0.5 font-bold ${LEVEL_BADGE[log.level]}`}
                  >
                    {log.level}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 ${SOURCE_BADGE[log.source]}`}
                  >
                    {log.source === "browser"
                      ? `ブラウザ${log.device ? ` (${log.device})` : ""}`
                      : "サーバ"}
                  </span>
                  <time>{LOG_TIME_FORMAT.format(log.at)}</time>
                </div>
                <pre className="whitespace-pre-wrap break-all font-mono text-sm">
                  {log.text}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageTransition>
  );
}

// 速度計測の行 (docs/119 §1-3)。警告・エラーとは別の控えで、ここでだけ出す。
// 1 行 1 計測を新しい順に。読むときは「コピー」で手元へ持ち出す
function PerfLogs() {
  const enabled = isPerfLogEnabled();
  const lines = recentPerfLines();
  return (
    <PageTransition>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">計測</h1>
          <span className="flex items-baseline gap-1">
            <Link href="/logs" className={ACTION_LINK_CLASS}>
              ログ
            </Link>
            <Link href="/" transitionTypes={["nav-back"]} className={ACTION_LINK_CLASS}>
              検索へ
            </Link>
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <p className="text-gray-500">
            {enabled ? "計測中です。" : "計測は止まっています。"}
            速度計測の行 (新しい順、200 件)。切り替えは全端末に効き、各端末は
            読み込み直してから測り始めます。サーバが再起動すると止まります。
            遅い SQL の行は、起動時に PERF_LOG=1 のときだけ出ます。
          </p>
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <PerfToggleButton enabled={enabled} />
            <CopyTextButton text={formatPerfLinesForCopy(lines)} subject="計測" />
            <ClearLogsButton perf />
          </span>
        </div>
        {lines.length === 0 ? (
          <p className="text-gray-500">計測の行はありません。</p>
        ) : (
          <ul className="space-y-1">
            {lines.map((line, i) => (
              <li
                key={`${line.at}-${i}`}
                className="rounded border border-gray-300 bg-white px-2 py-1"
              >
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span className={`rounded px-1.5 py-0.5 ${SOURCE_BADGE[line.source]}`}>
                    {line.source === "browser" ? (line.device ?? "ブラウザ") : "サーバ"}
                  </span>
                  <time>{LOG_TIME_FORMAT.format(line.at)}</time>
                </div>
                <pre className="whitespace-pre-wrap break-all font-mono text-sm">
                  {line.text}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageTransition>
  );
}
