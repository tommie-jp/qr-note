"use client";

import { useAsyncAction } from "@/components/hooks/useAsyncAction";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { errorText } from "@/lib/errorMessage";

// 速度計測の開始 / 停止 (docs/119-速度計測ログ計画.md §1-4)。
// 押したら読み込み直す — ブラウザ側の観測は root layout が描くかどうかで
// 決まるので、この端末でもそれで効き始める (ClearLogsButton と同じく router は使わない)
export function PerfToggleButton({ enabled }: { enabled: boolean }) {
  const { run, busy, error } = useAsyncAction();

  const toggle = () =>
    run(
      async () => {
        const res = await fetch("/api/logs/perf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !enabled }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        location.reload();
      },
      (e) => `計測を切り替えられませんでした (${errorText(e)})`,
    );

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-busy={busy}
        className={ACTION_LINK_CLASS}
      >
        {enabled ? "計測を止める" : "計測を始める"}
      </button>
    </span>
  );
}
