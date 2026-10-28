"use client";

import { useState } from "react";
import { StopwatchIcon } from "@/components/icons";
import { HEADER_MENU_ITEM_CLASS } from "@/components/ui";
import { clearPerfTestPending, markPerfTestPending } from "@/lib/logging/perfTestFlag";

// メニューの「計測テスト開始 / 終了」(docs/120-計測テスト自動化計画.md §1)。
//
// 開始: 計測を立て (全端末に効く。docs/119 §1-4)、流す印を付けて検索画面を
// 読み込み直す。読み込み直した先で PerfTestRunner が手順を流す。
// 終了: 計測を止めて読み込み直す。
//
// running はサーバの切替の値 (AppHeaderMenu が読む)。**計測中も「開始」を出す**
// — PC で開始した後に iPhone でも同じ手順を流すとき、2 台目には計測が既に
// 立っていて、「終了」しか無いと流せない。そのときの開始は印を付けて読み込み
// 直すだけになる
export function PerfTestMenuItem({ running }: { running: boolean }) {
  const [busy, setBusy] = useState(false);

  async function setPerf(enabled: boolean): Promise<void> {
    const res = await fetch("/api/logs/perf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      // 握りつぶさない (この console.error は転送に乗って /logs に出る)
      console.error("計測テストを切り替えられませんでした", error);
      setBusy(false);
    }
  }

  const start = () =>
    act(async () => {
      if (!running) {
        await setPerf(true);
      }
      markPerfTestPending();
      // 読み込み直しが要る (ブラウザ側の観測は root layout が描くかどうかで
      // 決まり、ソフトな遷移では現れない)。router.push では足りない
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.assign("/");
    });

  const stop = () =>
    act(async () => {
      await setPerf(false);
      clearPerfTestPending();
      location.reload();
    });

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
        className={HEADER_MENU_ITEM_CLASS}
      >
        <StopwatchIcon />
        計測テスト開始
      </button>
      {running && (
        <button
          type="button"
          onClick={stop}
          disabled={busy}
          aria-busy={busy}
          className={HEADER_MENU_ITEM_CLASS}
        >
          <StopwatchIcon />
          計測テスト終了
        </button>
      )}
    </>
  );
}
