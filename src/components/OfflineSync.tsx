"use client";

import { useEffect } from "react";
import type { OfflineSyncPayload } from "@/lib/offline/item";
import { syncPinnedAssets } from "@/lib/offline/pinCache";
import { registerOfflineWorker, warmOfflineShell } from "@/lib/offline/register";
import {
  LAST_SYNC_ATTEMPT_KEY,
  LAST_WARM_VERSION_KEY,
  readMark,
  shouldAutoSync,
  writeMark,
} from "@/lib/offline/schedule";
import { syncOfflineItems } from "@/lib/offline/sync";

// オフライン用の下ごしらえ (docs/65-オフライン対応計画.md)。何も描かない。
//
// layout.tsx が**ログイン中のときだけ**置く。同期の口は 401 を返すので、
// 未ログインで仕掛けても失敗するだけ (ClientLogCapture と同じ判断)。
//
// やることは 4 つ:
//   1. Service Worker を版付きで登録する (殻と添付のキャッシュはあちらの担当)
//   2. ノート本文と描画済みの回路図を IndexedDB へ取り込む
//   3. 印付きノート (offline_pin) の添付を端末へ揃える
//   4. /offline の殻を保存させる (暖機)
//
// **どれが失敗しても画面は止めない。** オフラインで使えないだけで、
// オンラインの機能は何一つ変わらない。ただし黙って消えると原因が追えないので
// console には残す (ログイン中なら ClientLogCapture がサーバへ運ぶ)。

interface OfflineSyncProps {
  // アプリの版 (package.json)。Service Worker の登録 URL とキャッシュ名に混ぜ、
  // リリースごとに確実に入れ替える (register.ts)
  version: string;
}

export function OfflineSync({ version }: OfflineSyncProps) {
  useEffect(() => {
    // React の StrictMode と、戻る/進むでの再マウントで二重に走らないようにする。
    // 途中で外れたら以降の副作用を捨てる
    let cancelled = false;

    const run = async () => {
      // 圏外だと判っているときは何もしない。onLine は「オンラインである」ことの
      // 保証にはならないが、false は「確実に圏外」なので見送る根拠になる
      if (!navigator.onLine) {
        return;
      }

      // null = Worker が居ない (未対応の端末、または開発サーバ。register.ts)。
      // そのときは暖機を試みない — 待っても誰も返事をしない
      let hasWorker = false;
      try {
        hasWorker = (await registerOfflineWorker(version)) !== null;
      } catch (error) {
        console.warn("OfflineSync: Service Worker を登録できませんでした", error);
        // 登録できなくても本文の同期はできる (IndexedDB は Worker と独立)。
        // 続ける
      }
      if (cancelled) return;

      // 版が変われば /offline のチャンク名も変わる。間隔の都合で暖機を
      // 見送ると、新しい版の殻が空のまま圏外へ出る窓ができるので、そのときは
      // 間隔を無視して通す。
      //
      // **hasWorker を条件に含めるのが要点。** 暖機できない環境 (Worker が
      // 居ない) では成功の記録が永久に書かれず、版が違う扱いのまま毎回この
      // 関門を素通りする — 全ノートを画面遷移のたびに落とし直すことになり、
      // 間隔を置いた意味 (シールを何枚も読むときの通信量) が消える。
      //
      // localStorage は readMark/writeMark 経由で触る — 素で触ると、
      // 保存を塞いだブラウザで例外がここを突き抜けて全部止まる (schedule.ts)
      const needsWarm = hasWorker && readMark(LAST_WARM_VERSION_KEY) !== version;
      if (!needsWarm && !shouldAutoSync(readMark(LAST_SYNC_ATTEMPT_KEY), Date.now())) {
        return;
      }
      // 成否に関わらず先に記録する。失敗のたびに全力で撃ち直すと、圏外で
      // 開くたびにタイムアウトを待たされる (schedule.ts の冒頭)
      writeMark(LAST_SYNC_ATTEMPT_KEY, String(Date.now()));

      let payload: OfflineSyncPayload | null = null;
      try {
        payload = await syncOfflineItems();
      } catch (error) {
        console.warn("OfflineSync: ノートを同期できませんでした", error);
      }
      if (cancelled) return;

      // 印付きノートの添付を揃える (docs/65-オフライン対応計画.md §10)。
      //
      // **ここだけは自動で通信量を使う。** サムネの全件先読みを手動にしている
      // のと矛盾しては見えるが、印は「このノートは圏外でも原寸まで要る」と
      // 利用者が 1 件ずつ選んだ結果で、断りは既に取れている。逆に、選んだのに
      // 毎回 /offline を開いてボタンを押させるなら印の意味が無い。
      //
      // Worker が居なくても走らせる — 書くのはこちら側で、居ないと困るのは
      // 返す側だけ (pinCache.ts)。
      if (payload !== null && payload.items.some((item) => item.pinned)) {
        try {
          const result = await syncPinnedAssets(payload.items);
          if (result.failed > 0) {
            console.warn(
              `OfflineSync: 印付きノートの添付を ${result.failed} 件保存できませんでした`,
            );
          }
        } catch (error) {
          console.warn("OfflineSync: 印付きノートを保存できませんでした", error);
        }
      }
      if (cancelled || !hasWorker) return;

      const warmed = await warmOfflineShell();
      if (warmed.ok) {
        writeMark(LAST_WARM_VERSION_KEY, version);
      } else {
        console.warn("OfflineSync: オフライン画面を保存できませんでした", warmed.error);
      }
    };

    void run();
    // 圏外から戻ったときに取り直す (docs/65-オフライン対応計画.md §3-3)。開きっぱなしの端末が
    // 電波を掴んだ瞬間に追いつけるようにする
    window.addEventListener("online", run);
    return () => {
      cancelled = true;
      window.removeEventListener("online", run);
    };
  }, [version]);

  return null;
}
