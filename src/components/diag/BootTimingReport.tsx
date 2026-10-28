"use client";

import { useEffect } from "react";
import {
  BOOT_REPORT_FALLBACK_MS,
  type BootTiming,
  formatBootTiming,
  LAST_BOOT_REPORT_VERSION_KEY,
  parseWorkerVersion,
  readBootTiming,
  shouldReportBoot,
} from "@/lib/logging/bootTiming";
import { logDiagEvent, logPerfEvent } from "@/lib/logging/diagLog";
import { readMark, writeMark } from "@/lib/offline/schedule";

// 起動にかかった時間の内訳を /logs へ送る。何も描かない。
// 何のための計測かは src/lib/logging/bootTiming.ts の冒頭に書いた。
//
// localStorage の出入りは offline/schedule.ts の readMark/writeMark を借りる。
// 素で触ると保存を塞いだブラウザで例外が突き抜ける、という理由はあちらと同じで、
// 書き写すと片方だけ直す事故になる。

// **1 回の読み込みにつき 1 度だけ送る。** layout に置くのでソフトな画面遷移では
// 再マウントされないが、StrictMode の二重実行と戻る/進むの再マウントがある
// (logging/diagLog.ts の logEnvironmentOnce と同じ守り)
let reported = false;
// 途中経過を送ったか。送っていれば、揃ったあとの行は**条件を問わず送る** —
// 右側が欠けた行だけが残ると、load まで含めて遅かったのかが判らない
let partialReported = false;

interface BootTimingReportProps {
  // アプリの版 (package.json)。管理している Worker の版と食い違っていれば、
  // 「古い Worker がこの起動を捌いた」と読める
  version: string;
  // 速度計測中 (docs/119 §3-4)。条件を問わず毎回、計測の控えへ送る
  always?: boolean;
}

export function BootTimingReport({ version, always = false }: BootTimingReportProps) {
  useEffect(() => {
    if (reported) {
      return;
    }

    // **控えは効果の入口で 1 度だけ読む。** 下で書き戻すので、send の中で
    // 読み直すと自分が書いた値を読んでしまい、「版が変わった初回」を自分で
    // 消してしまう (途中経過を送れなかった回の仕上げが黙って落ちる)
    const lastReportedVersion = readMark(LAST_BOOT_REPORT_VERSION_KEY);

    // **控えられるかは、書いて読み返すまで判らない。** writeMark は保存を
    // 塞いだブラウザでも黙って何もしない (schedule.ts) ため、成否が返らない。
    // 控えられない端末では readMark が常に null で「版が変わった初回」が毎回
    // 成立し、読み込みのたびに起動行が積まれて 200 件のリングバッファを
    // 埋めてしまう (shouldReportBoot の canRemember)。
    //
    // ここで先に書いても意味は変わらない — 報告するなら結局書く印で、
    // 報告しない回 (= 同じ版の速い起動) は既にこの版が書かれている
    writeMark(LAST_BOOT_REPORT_VERSION_KEY, version);
    const canRemember = readMark(LAST_BOOT_REPORT_VERSION_KEY) === version;

    // 送る (送ったら true)。forced は「条件を問わず送る」— 途中経過を送った
    // あとの仕上げに使う
    const send = (timing: BootTiming, forced: boolean): boolean => {
      const diagnostic =
        forced ||
        shouldReportBoot(timing, lastReportedVersion, version, { canRemember });
      if (!diagnostic && !always) {
        return false;
      }

      const line = formatBootTiming(timing, {
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
        });
      // 普通の条件 (版が変わった初回・遅い起動) に当たる行は今までどおり /logs へ。
      // 計測中はそれとは別に、毎回の行を計測の控えへ送る (docs/119 §3-4)。
      // 計測の控えにだけ送ると、版が変わった初回の行が打鍵の行に押し流され、
      // 控えの版は「報告済み」になっているので二度と出てこない
      if (diagnostic) {
        logDiagEvent(line);
      }
      if (always) {
        logPerfEvent(line);
      }
      return diagnostic;
    };

    // load 後の本番。**loadEventEnd は load が終わるまで 0** なので 1 tick 遅らせて読む
    const reportComplete = () => {
      reported = true;
      const timing = readBootTiming();
      if (timing !== null) {
        send(timing, partialReported);
      }
    };

    // load を待てなかったときの途中経過 (logging/bootTiming.ts の BOOT_REPORT_FALLBACK_MS)。
    // ここまで来ていれば responseStart / responseEnd / FCP は確定しており、
    // 白い時間がサーバ側か Worker 側かはこれだけで切り分けられる
    const reportPartial = () => {
      const timing = readBootTiming();
      if (timing === null || timing.loadMs > 0) {
        // 既に load 済み: 欠けの無い行を reportComplete が送る
        return;
      }
      partialReported = send(timing, false);
    };

    let loadTimer: number | undefined;
    let fallbackTimer: number | undefined;
    const onLoad = () => {
      window.clearTimeout(fallbackTimer);
      loadTimer = window.setTimeout(reportComplete, 0);
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      fallbackTimer = window.setTimeout(reportPartial, BOOT_REPORT_FALLBACK_MS);
    }
    return () => {
      window.removeEventListener("load", onLoad);
      window.clearTimeout(loadTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, [version, always]);

  return null;
}
