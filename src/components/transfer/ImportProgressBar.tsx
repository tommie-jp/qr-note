"use client";

import type { ImportProgressView } from "@/components/transfer/useImportProgress";

// 取り込み中の待ち時間の見せ方 (docs/28-エクスポート計画.md §9)。
//
// 500MB を受けられるようになって、取り込みは分単位で待つ操作になった。
// 「取り込み中…」の一言だけでは、進んでいるのか固まっているのか見分けが
// 付かない。
//
// **数字が出せないときは黙る**。総バイト数を名乗らない相手では % を、
// 始まったばかりのうちは残り時間を出さない — 初速で計算した「残り 4000 秒」が
// 一瞬見えるのは、数字が無いより悪い。
export function ImportProgressBar({ progress }: { progress: ImportProgressView | null }) {
  const percent = progress?.percent ?? null;

  return (
    <div className="space-y-2">
      <div
        className="h-2 overflow-hidden rounded bg-gray-200"
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="取り込みの進み具合"
      >
        <div
          // % が判らない間は「動いてはいる」ことだけ伝える細い帯にする
          className={`h-full bg-blue-600 transition-[width] duration-300 ${
            percent === null ? "w-1/12 animate-pulse" : ""
          }`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-gray-600">
        {percent === null ? "取り込み中…" : `取り込み中… ${percent}%`}
        {progress?.remainingText && ` ・ ${progress.remainingText}`}
      </p>
      {progress?.phase === "notes" && (
        <p className="text-sm text-gray-600">
          ノートを反映しています ({progress.notesDone}/{progress.notesTotal})
        </p>
      )}
      <p className="text-sm text-gray-600">
        画像の変換とサムネイル作成に時間がかかります。このページを閉じずにお待ちください。
      </p>
    </div>
  );
}
