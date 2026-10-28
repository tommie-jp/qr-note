"use client";

import { useEffect, useState } from "react";
import { flushClientLogs } from "@/lib/logging/clientCapture";
import { isPerfIdle, perfSend } from "@/lib/logging/perfClient";
import { runPerfTest, type PerfTestStatus } from "@/lib/logging/perfTest";
import { takePerfTestPending } from "@/lib/logging/perfTestFlag";
import { syncOfflineItems } from "@/lib/offline/sync";

// 計測テストを流す (docs/120-計測テスト自動化計画.md §2)。
// root layout が**計測中だけ** PerfReport の隣に置く。メニューの「計測開始」が
// 付けた印 (perfTestFlag.ts) があれば、読み込み直した直後に手順を流して
// 最後に計測を止め、進み具合を画面の下に小さく出す。印が無ければ何も描かない。
//
// 手順の並びは lib/logging/perfTest.ts。ここは DOM の手足だけを組む

const TYPE_DELAY_MS = 120;
// 完了の知らせを残しておく時間
const DONE_NOTICE_MS = 8000;

const SEARCH_INPUT = 'input[type="search"][name="q"]';
const NOTE_LINKS = '[data-results-pane] a[href^="/item/"]';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// React の制御された入力に値を入れる。value に直接代入すると React が
// 自分の控えと同じと見なして onChange を呼ばないので、原型の setter を通す
function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
    input,
    value,
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function typeQuery(query: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(SEARCH_INPUT);
  if (input === null) {
    return;
  }
  input.focus();
  setInputValue(input, "");
  for (let i = 1; i <= query.length; i += 1) {
    await sleep(TYPE_DELAY_MS);
    setInputValue(input, query.slice(0, i));
  }
}

// 2 件目を開く (先頭は 2・3 ペインで自動で開いている)。1 件しか無ければ先頭
function openNote(): boolean {
  const links = document.querySelectorAll<HTMLAnchorElement>(NOTE_LINKS);
  const link = links[1] ?? links[0];
  if (link === undefined) {
    return false;
  }
  link.click();
  return true;
}

function describeDevice(): readonly (readonly [string, string])[] {
  const panes =
    document.querySelector("[data-panes]")?.getAttribute("data-panes") ?? "未了";
  return [
    ["panes", panes],
    ["幅", `${window.innerWidth}x${window.innerHeight}`],
  ];
}

export function PerfTestRunner() {
  const [status, setStatus] = useState<PerfTestStatus | null>(null);

  useEffect(() => {
    if (!takePerfTestPending()) {
      return;
    }
    let cancelled = false;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    void runPerfTest({
      sleep,
      now: () => performance.now(),
      isIdle: isPerfIdle,
      typeQuery,
      openNote,
      sync: async () => {
        await syncOfflineItems();
      },
      send: perfSend,
      flush: flushClientLogs,
      stop: async () => {
        const res = await fetch("/api/logs/perf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      },
      report: (next) => {
        if (cancelled) return;
        setStatus(next);
        if (next.done) {
          hideTimer = setTimeout(() => setStatus(null), DONE_NOTICE_MS);
        }
      },
      describe: describeDevice,
    }).catch((error: unknown) => {
      console.warn("計測テストが途中で止まりました", error);
    });
    return () => {
      cancelled = true;
      if (hideTimer !== null) clearTimeout(hideTimer);
    };
  }, []);

  if (status === null) {
    return null;
  }
  return (
    <div
      role="status"
      // 下端は iPhone のホームバーの上 (pb-safe は 1.5rem の下限があって高すぎる)
      style={{ bottom: "env(safe-area-inset-bottom)" }}
      className="fixed inset-x-0 z-50 mx-auto w-fit rounded bg-orange-600 px-3 py-1 text-sm text-white shadow"
    >
      {status.done
        ? `計測${status.label}。Claude に「終わった」と伝えてください`
        : `計測 ${status.step}/${status.total}: ${status.label}…`}
    </div>
  );
}
