"use client";

import { useEffect, useState } from "react";
import {
  type BenchmarkStatus,
  getBenchmarkStatusAction,
  startBenchmarkAction,
} from "@/app/actions/benchmark";
import { COMPACT_SECONDARY_BUTTON_CLASS } from "@/components/ui";
import { errorText } from "@/lib/errorMessage";

// 計測の終わりを見に行く間隔
const POLL_MS = 3000;

// CPU を 1 分ほど使い切るので、画面を開いただけでは走らせず釦で測る。
// 計測はサーバ側で裏で走り、ここは終わるまで状態を引き続ける (リクエストを
// 1 分つなぎっぱなしにすると nginx に切られる)。結果はサーバがファイルに残し、
// 次に開いたときは initial として渡される。計測中に画面を開き直しても続きを待つ
export function BenchmarkButton({ initial }: { initial: BenchmarkStatus }) {
  const [status, setStatus] = useState<BenchmarkStatus>(initial);
  const [error, setError] = useState<string | null>(initial.error);

  useEffect(() => {
    if (!status.running) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const next = await getBenchmarkStatusAction();
        setStatus(next);
        setError(next.error);
      } catch (cause) {
        setStatus((prev) => ({ ...prev, running: false }));
        setError(errorText(cause));
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const start = async () => {
    setError(null);
    try {
      const next = await startBenchmarkAction();
      setStatus(next);
      setError(next.error);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <div className="space-y-2 text-sm">
      <button
        type="button"
        onClick={() => void start()}
        disabled={status.running}
        className={COMPACT_SECONDARY_BUTTON_CLASS}
      >
        {status.running
          ? "計測中… (1 分ほど)"
          : status.saved
            ? "再計測する"
            : "計測する"}
      </button>
      {status.saved ? (
        <p className="text-gray-800">{status.saved}</p>
      ) : (
        <p className="text-gray-500">未計測</p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          計測できませんでした: {error}
        </p>
      )}
    </div>
  );
}
