"use client";

import { useEffect, useState } from "react";
import { flushClientLogs } from "@/lib/logging/clientCapture";
import { isPerfIdle, perfSend, perfSetViewPhase } from "@/lib/logging/perfClient";
import { measureNet, UPLOAD_BYTES, type NetProbeDeps } from "@/lib/logging/netProbe";
import { runPerfTest, type PerfTestStatus, type PerfViewPhase } from "@/lib/logging/perfTest";
import {
  clearPerfTestRunning,
  markPerfTestRunning,
  takePerfTestInterrupted,
  takePerfTestPending,
} from "@/lib/logging/perfTestFlag";
import { syncOfflineItems } from "@/lib/offline/sync";

// 計測テストを流す (docs/120-計測テスト自動化計画.md §2)。
// root layout が**計測中だけ** PerfReport の隣に置く。メニューの「計測開始」が
// 付けた印 (perfTestFlag.ts) があれば、読み込み直した直後に手順を流して
// 最後に計測を止め、進み具合を画面の下に小さく出す。印が無ければ何も描かない。
//
// 手順の並びは lib/logging/perfTest.ts。ここは DOM の手足だけを組む

const TYPE_DELAY_MS = 120;
// 表示モードの釦を押してから、次を押すまでの待ち。押した結果が描き直されて
// 釦の名前が変わるのを待つ (変わる前に押すと同じモードにもう一度送る)
const VIEW_SWITCH_SETTLE_MS = 1500;
// 完了の知らせを残しておく時間
const DONE_NOTICE_MS = 8000;
// 戻り先 (ベンチマークの画面) へ移る前の間。完了の知らせを読める程度
const RETURN_DELAY_MS = 1500;
// crypto.getRandomValues が 1 回に埋められる上限
const RANDOM_CHUNK = 65536;

const SEARCH_INPUT = 'input[type="search"][name="q"]';
// 一覧の行の題名リンク。**`a[href^="/item/"]` で拾わない** — 3 ペインでは
// 一覧の領域の中にノート側の操作 (アイコンの釦・「次 →」) も入っていて、
// 本番ではそれを押して全体の読み込み直しになり、手順が途切れた
const NOTE_LINKS = '[data-results-pane] a[data-note-title]';

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

// 一覧の index 番目 (0 始まり) を開く。足りなければ最後の行 (1 件だけの検索でも流す)
function openNote(index: number): boolean {
  const links = document.querySelectorAll<HTMLAnchorElement>(NOTE_LINKS);
  const link = links[index] ?? links[links.length - 1];
  if (link === undefined) {
    return false;
  }
  link.click();
  return true;
}

// 一覧の内側スクロールの器 (2・3 ペインと広い画面)。無ければ文書ごとスクロールする
const RESULTS_SCROLL = "[data-results-scroll]";
// 続きがあることの目印 (components/search/loadMore.ts)
const LOAD_MORE_MARK = "[data-auto-load-more]";

// 一覧を一番下まで送って、続きの読み込みを起こす (利用者のスクロールと同じ入口)。
// 続きの目印が無ければ (全件が 1 ページに収まる) false
function scrollMore(): boolean {
  if (document.querySelector(LOAD_MORE_MARK) === null) {
    return false;
  }
  const scroller = document.querySelector<HTMLElement>(RESULTS_SCROLL);
  if (scroller !== null && scroller.scrollHeight > scroller.clientHeight) {
    scroller.scrollTo({ top: scroller.scrollHeight });
  } else {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }
  return true;
}

// 表示モードの釦。aria-label は「表示: 小 (押すと中に切替、長押しで一覧)」の形
// (components/bottombar/ViewSlot.tsx)
const VIEW_BUTTON = 'button[aria-label^="表示:"]';
const VIEW_FROM_LABEL: Readonly<Record<string, string>> = {
  小: "compact",
  中: "medium",
  大: "card",
  画像: "image",
};

function viewButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(VIEW_BUTTON);
}

// 釦の名前から今の表示モードを読む。cookie は httpOnly で JS から読めない
function currentView(): string {
  const label = viewButton()?.getAttribute("aria-label") ?? "";
  const shown = /^表示: (\S+)/.exec(label)?.[1] ?? "";
  return VIEW_FROM_LABEL[shown] ?? "unknown";
}

// 目的の表示モードになるまで釦を押す (押すたびに次のモードへ循環)。
// 押してから描き直されるまでは釦の名前が変わらないので、1 回ずつ待つ。
// 循環は 4 つなので、4 回押して着かなければ諦める (釦が壊れていても止まらない)
async function switchView(to: string, phase: PerfViewPhase): Promise<boolean> {
  for (let i = 0; i < Object.keys(VIEW_FROM_LABEL).length; i += 1) {
    if (currentView() === to) {
      return true;
    }
    const button = viewButton();
    if (button === null) {
      return false;
    }
    // 押す直前に区分を置く。ResultsToolbar の perfStart('表示') が 1 回読む
    perfSetViewPhase(phase);
    button.click();
    await sleep(VIEW_SWITCH_SETTLE_MS);
  }
  return currentView() === to;
}

function describeDevice(): readonly (readonly [string, string])[] {
  const panes =
    document.querySelector("[data-panes]")?.getAttribute("data-panes") ?? "未了";
  return [
    ["panes", panes],
    ["幅", `${window.innerWidth}x${window.innerHeight}`],
  ];
}

// 上りの計測に送る本文。乱数にするのは、圧縮できる中身だと経路で縮んで嘘になるため
function uploadBody(): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(UPLOAD_BYTES);
  for (let at = 0; at < body.length; at += RANDOM_CHUNK) {
    crypto.getRandomValues(body.subarray(at, at + RANDOM_CHUNK));
  }
  return body;
}

// 下りの受信時間。同じ URL の最後の entry の responseStart → responseEnd
// (Safari も Resource Timing を持つ。読めなければ null で netProbe が代える)
function receiveMs(url: string): number | null {
  const href = new URL(url, location.href).href;
  const entry = performance.getEntriesByName(href).at(-1) as
    | PerformanceResourceTiming
    | undefined;
  if (entry === undefined || entry.responseStart <= 0) {
    return null;
  }
  const ms = entry.responseEnd - entry.responseStart;
  return ms > 0 ? ms : null;
}

const NET_DEPS: NetProbeDeps = {
  fetch: (input, init) => fetch(input, init),
  now: () => performance.now(),
  receiveMs,
};

async function stopPerf(): Promise<void> {
  const res = await fetch("/api/logs/perf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

// 前の手順が途中で切れていたら、そのことを残して計測を止める。止めないと
// 計測が立ったまま残り、普段の操作の行が控えを押し流す
function recoverInterrupted(): void {
  if (!takePerfTestInterrupted()) {
    return;
  }
  perfSend("テスト", [["結果", "中断"]]);
  flushClientLogs();
  stopPerf().catch((error: unknown) => {
    console.warn("途中で切れた計測テストの計測を止められませんでした", error);
  });
}

export function PerfTestRunner() {
  const [status, setStatus] = useState<PerfTestStatus | null>(null);

  useEffect(() => {
    const options = takePerfTestPending();
    if (options === null) {
      recoverInterrupted();
      return;
    }
    markPerfTestRunning();
    let cancelled = false;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    void runPerfTest({
      sleep,
      now: () => performance.now(),
      isIdle: isPerfIdle,
      typeQuery,
      openNote,
      scrollMore,
      currentView,
      switchView,
      sync: async () => {
        await syncOfflineItems();
      },
      send: perfSend,
      flush: flushClientLogs,
      stop: stopPerf,
      report: (next) => {
        if (next.done) clearPerfTestRunning();
        if (cancelled) return;
        setStatus(next);
        if (next.done) {
          hideTimer = setTimeout(() => setStatus(null), DONE_NOTICE_MS);
        }
      },
      describe: describeDevice,
      line: options.line,
      measureNet:
        options.line === undefined
          ? undefined
          : () => measureNet(NET_DEPS, uploadBody()),
    }).then(() => {
      // ベンチマークの画面から流したときは、結果の出る画面へ戻る (docs/121 §4-2)
      const { returnTo } = options;
      if (returnTo !== undefined && !cancelled) {
        setTimeout(() => location.assign(returnTo), RETURN_DELAY_MS);
      }
    }).catch((error: unknown) => {
      console.warn("計測テストが途中で止まりました", error);
      // 計測を立てたまま残さない (recoverInterrupted と同じ理由)
      clearPerfTestRunning();
      stopPerf().catch(() => {});
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
