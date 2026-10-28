"use client";

import { useEffect } from "react";

// active の間だけ画面を消さない (Screen Wake Lock API。docs/117 §4)。
// スライドショーを眺めている間に端末が暗くなって止まらないようにする。
//
// - 使えない環境 (古いブラウザ・非 HTTPS) では黙って何もしない。消灯の
//   抑止は「あれば嬉しい」もので、無くてもスライドショー自体は動く
// - ロックはタブが裏に回ると OS が勝手に外す。表に戻ったら取り直す
// - 取得は非同期。取れる前に active が落ちたら、取れた瞬間に離す
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) {
      return;
    }
    let cancelled = false;
    let sentinel: WakeLockSentinel | null = null;
    // 取りに行っている最中。表へ戻るのが返事より早いと 2 本取り、
    // 先の 1 本が誰にも離されずに残る
    let pending = false;

    const acquire = async () => {
      if (pending) {
        return;
      }
      pending = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await lock.release();
          return;
        }
        sentinel = lock;
      } catch (error) {
        // 電池残量が少ない・権限ポリシーで拒否された、など。再生は続ける
        console.warn("画面の消灯を止められませんでした", error);
      } finally {
        pending = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && sentinel?.released !== false) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release().catch(() => {
        // 既に OS が外していた。離す物が無いだけなので捨ててよい
      });
    };
  }, [active]);
}
