"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatRemaining,
  type ImportPhase,
  type ImportProgress,
  importPercent,
  PROGRESS_POLL_MS,
  remainingSeconds,
} from "@/lib/zip/importProgress";

interface ProgressResponse {
  success: boolean;
  data: ImportProgress | null;
  error: string | null;
}

export interface ImportProgressView {
  // 0〜100。総バイト数が判らないときは null (バーは出さず動きだけ見せる)
  percent: number | null;
  // 「残り約 12 秒」。まだ見積もれないときは null
  remainingText: string | null;
  phase: ImportPhase;
  notesDone: number;
  notesTotal: number;
}

// 取り込み中だけサーバの控えを覗く (docs/28-エクスポート計画.md §9)。
//
// **本体の fetch とは別要求**。ブラウザの XHR で送信の進みを見る手もあるが、
// この口はサーバが読んだ量そのものが進捗になる (本番の nginx は /api/import
// だけ proxy_request_buffering off なので、読めた量 = 送れた量)。そのうえ
// アップロード完了後にもノートの反映が残るので、どのみちサーバに聞くしかない。
//
// **進捗が取れないことは失敗にしない**。覗きに失敗したら最後の値のまま
// 黙って進む — 取り込みの成否は本体の fetch が決める。
export function useImportProgress(active: boolean): ImportProgressView | null {
  const [view, setView] = useState<ImportProgressView | null>(null);
  // 経過は「取り込みを始めた瞬間」から測る。サーバの startedAt を使うと
  // 時計のずれを持ち込むうえ、最初の 1 回を覗くまで測れない
  const startedAtRef = useRef(0);

  // 取り込みの開始・終了で控えを捨てる。**描画中に畳む**のは、次の取り込みの
  // 頭で前回の「100%」が一瞬見えるのを防ぐため (effect で消すと 1 描画遅れる)
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    setView(null);
  }

  useEffect(() => {
    if (!active) {
      return;
    }

    startedAtRef.current = Date.now();
    let stopped = false;

    const poll = async () => {
      try {
        const response = await fetch("/api/import/progress", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const result: ProgressResponse = await response.json();
        if (stopped || !result.success || result.data === null) {
          return;
        }
        setView(toView(result.data, Date.now() - startedAtRef.current));
      } catch {
        // 覗けなかっただけ。次の周回で拾い直す (本体の取り込みには影響しない)
      }
    };

    void poll();
    const timer = setInterval(poll, PROGRESS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active]);

  return view;
}

function toView(progress: ImportProgress, elapsedMs: number): ImportProgressView {
  const percent = importPercent(progress);
  const seconds = remainingSeconds(percent, elapsedMs);
  return {
    percent,
    remainingText: seconds === null ? null : formatRemaining(seconds),
    phase: progress.phase,
    notesDone: progress.notesDone,
    notesTotal: progress.notesTotal,
  };
}
