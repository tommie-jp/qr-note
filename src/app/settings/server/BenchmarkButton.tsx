"use client";

import { useState, useTransition } from "react";
import { runBenchmarkAction } from "@/app/actions/benchmark";
import { COMPACT_SECONDARY_BUTTON_CLASS } from "@/components/ui";
import { errorText } from "@/lib/errorMessage";

// CPU を 1 分ほど使い切るので、画面を開いただけでは走らせず釦で測る。
// 結果はサーバがファイルに残し、次に開いたときは saved として渡される
export function BenchmarkButton({ saved }: { saved: string | null }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(saved);
  const [error, setError] = useState<string | null>(null);

  const measure = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await runBenchmarkAction();
        if (r.ok) {
          setResult(r.text);
        } else {
          setError(r.message);
        }
      } catch (cause) {
        setError(errorText(cause));
      }
    });
  };

  return (
    <div className="space-y-2 text-sm">
      <button
        type="button"
        onClick={measure}
        disabled={pending}
        className={COMPACT_SECONDARY_BUTTON_CLASS}
      >
        {pending ? "計測中… (1 分ほど)" : result ? "再計測する" : "計測する"}
      </button>
      {result ? <p className="text-gray-800">{result}</p> : <p className="text-gray-500">未計測</p>}
      {error && (
        <p role="alert" className="text-red-700">
          計測できませんでした: {error}
        </p>
      )}
    </div>
  );
}
