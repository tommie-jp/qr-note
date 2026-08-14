"use client";

import { useEffect } from "react";
import {
  formatBootTiming,
  LAST_BOOT_REPORT_VERSION_KEY,
  parseWorkerVersion,
  readBootTiming,
  shouldReportBoot,
} from "@/lib/bootTiming";
import { logDiagEvent } from "@/lib/diagLog";
import { readMark, writeMark } from "@/lib/offline/schedule";

// 起動にかかった時間の内訳を /logs へ送る。何も描かない。
// 何のための計測かは src/lib/bootTiming.ts の冒頭に書いた。
//
// localStorage の出入りは offline/schedule.ts の readMark/writeMark を借りる。
// 素で触ると保存を塞いだブラウザで例外が突き抜ける、という理由はあちらと同じで、
// 書き写すと片方だけ直す事故になる。

// **1 回の読み込みにつき 1 度だけ送る。** layout に置くのでソフトな画面遷移では
// 再マウントされないが、StrictMode の二重実行と戻る/進むの再マウントがある
// (diagLog.ts の logEnvironmentOnce と同じ守り)
let reported = false;

interface BootTimingReportProps {
  // アプリの版 (package.json)。管理している Worker の版と食い違っていれば、
  // 「古い Worker がこの起動を捌いた」と読める
  version: string;
}

export function BootTimingReport({ version }: BootTimingReportProps) {
  useEffect(() => {
    if (reported) {
      return;
    }

    const report = () => {
      reported = true;
      // **load の後で読む。** loadEventEnd は load が終わるまで 0 で、
      // 早く読むと内訳の右端だけ欠けた行になる
      const timing = readBootTiming();
      if (timing === null) {
        return;
      }
      if (!shouldReportBoot(timing, readMark(LAST_BOOT_REPORT_VERSION_KEY), version)) {
        return;
      }
      writeMark(LAST_BOOT_REPORT_VERSION_KEY, version);

      logDiagEvent(
        formatBootTiming(timing, {
          version,
          workerVersion: parseWorkerVersion(
            navigator.serviceWorker?.controller?.scriptURL ?? null,
          ),
          // iOS の古い版は display-mode を返さないことがあるので
          // navigator.standalone も見る (iOS 独自)
          standalone:
            window.matchMedia("(display-mode: standalone)").matches ||
            (navigator as Navigator & { standalone?: boolean }).standalone === true,
          online: navigator.onLine,
        }),
      );
    };

    let timer: number | undefined;
    // load イベントの中では loadEventEnd がまだ確定していないため 1 tick 遅らせる
    const onLoad = () => {
      timer = window.setTimeout(report, 0);
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }
    return () => {
      window.removeEventListener("load", onLoad);
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [version]);

  return null;
}
