"use client";

import { useEffect, useRef, useState } from "react";
import {
  getBenchStatusAction,
  startCpuBenchAction,
  startServerBenchAction,
} from "@/app/actions/benchmark";
import { CopyTextButton } from "@/components/CopyTextButton";
import { COMPACT_SECONDARY_BUTTON_CLASS } from "@/components/ui";
import type { BenchStatus } from "@/lib/diag/benchStatus";
import {
  type ClientBenchRun,
  isNetLine,
  NET_LINES,
  type NetLine,
  type ServerBenchResult,
} from "@/lib/diag/benchTypes";
import {
  envRows,
  formatBenchCopy,
  formatMs,
  formatPhases,
} from "@/lib/diag/formatBench";
import { formatJstDateTime } from "@/lib/datetime";
import { errorText } from "@/lib/errorMessage";
import { markPerfTestPending } from "@/lib/logging/perfTestFlag";

// 計測の終わりを見に行く間隔
const POLL_MS = 3000;
// 前回選んだ回線 (端末ごとの便宜。読めなくても動く)
const LINE_STORAGE_KEY = "qr:benchLine";
const RETURN_PATH = "/settings/benchmark";

const TABLE_CLASS =
  "w-full divide-y divide-gray-200 rounded border border-gray-200 bg-white text-sm";
const CELL_CLASS = "px-3 py-1.5 text-left align-top";

function readSavedLine(): NetLine {
  try {
    const saved = localStorage.getItem(LINE_STORAGE_KEY);
    return isNetLine(saved) ? saved : "Wi-Fi";
  } catch {
    return "Wi-Fi";
  }
}

function saveLine(line: NetLine): void {
  try {
    localStorage.setItem(LINE_STORAGE_KEY, line);
  } catch {
    // 覚えられなくても次に選び直すだけ
  }
}

// 端末の計測は検索画面で計測テスト (docs/120) を流す。計測を立て、回線と戻り先を
// 印に添えて読み込み直す (PerfTestMenuItem の開始と同じ流れ)。終わると
// PerfTestRunner がここへ戻り、受け口が保存した要約が表に出る
async function startClientBench(line: NetLine): Promise<void> {
  const res = await fetch("/api/logs/perf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  if (!res.ok) {
    throw new Error(`計測を立てられませんでした (HTTP ${res.status})`);
  }
  markPerfTestPending({ line, returnTo: RETURN_PATH });
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  location.assign("/");
}

function KeyValueTable({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="divide-y divide-gray-200 rounded border border-gray-200 bg-white text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex gap-3 px-3 py-1.5">
          <dt className="w-36 shrink-0 text-gray-500">{row.label}</dt>
          <dd className="min-w-0 break-words text-gray-800">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ServerTable({ server }: { server: ServerBenchResult }) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className={TABLE_CLASS}>
          <thead className="text-gray-500">
            <tr>
              <th className={CELL_CLASS}>項目</th>
              <th className={`${CELL_CLASS} text-right`}>中央値</th>
              <th className={CELL_CLASS}>規模</th>
              <th className={CELL_CLASS}>段階</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 text-gray-800">
            {server.items.map((item) => (
              <tr key={item.id}>
                <td className={CELL_CLASS}>
                  {item.label}
                  {item.fixed && (
                    <span className="ml-1 rounded bg-emerald-100 px-1 text-xs text-emerald-800">
                      固定
                    </span>
                  )}
                </td>
                <td className={`${CELL_CLASS} text-right tabular-nums`}>
                  {formatMs(item.medianMs)}
                </td>
                <td className={CELL_CLASS}>{item.scale}</td>
                <td className={`${CELL_CLASS} text-gray-600`}>
                  {formatPhases(item.phases)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        「固定」は中身に依らない材料で測った行で、環境どうしを直接比べられます。他の行はノートの件数・中身に依ります
        (規模を見て比べてください)。どれもならし 1 回の後の 3 回の中央値です。
      </p>
      {server.failed.length > 0 && (
        <p role="alert" className="text-sm text-red-700">
          測れなかった項目:{" "}
          {server.failed.map((f) => `${f.id} (${f.message})`).join("、")}
        </p>
      )}
    </div>
  );
}

function ClientTable({ run }: { run: ClientBenchRun }) {
  return (
    <div className="space-y-1">
      <h3 className="font-bold">
        {run.device} / {run.line}
        <span className="ml-2 text-sm font-normal text-gray-500">
          panes={run.panes} 幅={run.width} ・{" "}
          {formatJstDateTime(new Date(run.measuredAt))}
        </span>
      </h3>
      <KeyValueTable rows={run.rows} />
    </div>
  );
}

export function BenchmarkPanel({ initial }: { initial: BenchStatus }) {
  const [status, setStatus] = useState<BenchStatus>(initial);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // 回線の選択は制御しない。前回の値は描き終えてから DOM に入れる
  // (サーバの描画と食い違わせない。state に入れ直す描き直しも要らない)
  const lineRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (lineRef.current) lineRef.current.value = readSavedLine();
  }, []);

  useEffect(() => {
    if (status.running === null) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setStatus(await getBenchStatusAction());
      } catch (cause) {
        setStatus((prev) => ({ ...prev, running: null }));
        setActionError(errorText(cause));
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const run = async (action: () => Promise<BenchStatus>) => {
    setActionError(null);
    try {
      setStatus(await action());
    } catch (cause) {
      setActionError(errorText(cause));
    }
  };

  const runClient = async () => {
    const chosen = lineRef.current?.value;
    const line: NetLine = isNetLine(chosen) ? chosen : "Wi-Fi";
    setActionError(null);
    setStarting(true);
    saveLine(line);
    try {
      await startClientBench(line);
    } catch (cause) {
      setStarting(false);
      setActionError(errorText(cause));
    }
  };

  const busy = status.running !== null || starting;
  const env = status.server?.env;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">計測</h2>
          <CopyTextButton
            text={formatBenchCopy(status)}
            subject="ベンチマーク"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => void run(startServerBenchAction)}
            disabled={busy}
            className={COMPACT_SECONDARY_BUTTON_CLASS}
          >
            {status.running === "server" ? "サーバを計測中… (数秒〜1 分)" : "サーバを計測"}
          </button>
          <button
            type="button"
            onClick={() => void run(startCpuBenchAction)}
            disabled={busy}
            className={COMPACT_SECONDARY_BUTTON_CLASS}
          >
            {status.running === "cpu" ? "CPU を計測中… (1 分ほど)" : "CPU を計測 (7z b)"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1 text-gray-700">
            回線
            <select
              ref={lineRef}
              defaultValue="Wi-Fi"
              className="rounded border border-gray-300 bg-white px-2 py-1"
            >
              {NET_LINES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void runClient()}
            disabled={busy}
            className={COMPACT_SECONDARY_BUTTON_CLASS}
          >
            {starting ? "検索画面へ移ります…" : "この端末を計測"}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          「この端末を計測」は検索画面で決まった操作 (回線 → 検索 3 語 → 表示の切替
          → ノート → 同期) を自動で流し、40 秒ほどでここへ戻ります。終わるまで触らないでください。
        </p>
        {[...status.errors, ...(actionError ? [actionError] : [])].map(
          (message) => (
            <p key={message} role="alert" className="text-sm text-red-700">
              {message}
            </p>
          ),
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">環境</h2>
        {env ? (
          <KeyValueTable rows={envRows(env)} />
        ) : (
          <p className="text-sm text-gray-500">未計測 (サーバを計測すると出ます)</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">CPU (7z b)</h2>
        <p className="text-sm text-gray-800">{status.cpu ?? "未計測"}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">サーバ</h2>
        {status.server ? (
          <ServerTable server={status.server} />
        ) : (
          <p className="text-sm text-gray-500">未計測</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">端末</h2>
        {status.clients.length > 0 ? (
          status.clients.map((client) => (
            <ClientTable key={`${client.device}/${client.line}`} run={client} />
          ))
        ) : (
          <p className="text-sm text-gray-500">未計測</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">回路の解析のプロファイル</h2>
        {status.profileAt ? (
          <p className="text-sm">
            <a
              href="/api/diag/profile"
              className="text-blue-700 underline"
              download
            >
              qr-benchmark-parse.cpuprofile
            </a>
            <span className="ml-2 text-gray-500">
              {formatJstDateTime(new Date(status.profileAt))} 取得。Chrome DevTools の
              Performance で「Load profile」から開きます
            </span>
          </p>
        ) : (
          <p className="text-sm text-gray-500">未取得 (サーバを計測すると取れます)</p>
        )}
      </section>
    </div>
  );
}
