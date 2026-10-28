"use client";

import { useState } from "react";
import { CopyTextButton } from "@/components/CopyTextButton";
import { useAsyncAction } from "@/components/hooks/useAsyncAction";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { errorText } from "@/lib/errorMessage";

// 計測ログの取得鍵の発行 (docs/120-計測テスト自動化計画.md §3)。
// 鍵はこの場で 1 度だけ見せる (サーバには hash しか残らない)。発行し直すと
// 前の鍵は使えなくなる。手元の ~/.config/qr-note/perf-token に保存すると、
// scripts/fetchPerfLog.sh がログインせずに計測行を読める
export function PerfExportTokenButton() {
  const { run, busy, error } = useAsyncAction();
  const [token, setToken] = useState<string | null>(null);

  const issue = () =>
    run(
      async () => {
        const res = await fetch("/api/logs/perf/token", { method: "POST" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as { data?: { token?: unknown } };
        if (typeof body.data?.token !== "string") {
          throw new Error("応答の形が違います");
        }
        setToken(body.data.token);
      },
      (e) => `取得鍵を発行できませんでした (${errorText(e)})`,
    );

  return (
    <div className="space-y-1">
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={issue}
          disabled={busy}
          aria-busy={busy}
          className={ACTION_LINK_CLASS}
        >
          取得鍵を発行
        </button>
        {error && (
          <span role="alert" className="text-sm text-red-700">
            {error}
          </span>
        )}
      </span>
      {token !== null && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
          <p>
            この鍵は今だけ表示します。手元の ~/.config/qr-note/perf-token に
            保存してください (前の鍵は使えなくなりました)。鍵で読めるのは
            計測行だけですが、検索語の先頭 20 文字が載ります。
          </p>
          <span className="flex items-center gap-2">
            <code className="break-all font-mono">{token}</code>
            <CopyTextButton text={token} subject="取得鍵" />
          </span>
        </div>
      )}
    </div>
  );
}
