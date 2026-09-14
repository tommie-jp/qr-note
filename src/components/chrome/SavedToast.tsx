"use client";

import { useEffect, useState } from "react";

const VISIBLE_MS = 2000;

// 「保存しました」を数秒だけ出す (docs/11-アプリ的UIUX計画.md §2-3)。
// 更新 → /item/:no?saved=<時刻> の redirect 直後に出す。
//
// 呼び出し側は key={saved} を付けること。連続して保存したとき、同じ位置の
// 同じコンポーネントは state を持ち越して visible=false のままになり、
// 2 回目のトーストが出ないため (key が変われば作り直される)。
export function SavedToast({ message = "保存しました" }: { message?: string }) {
  const [visible, setVisible] = useState(true);

  // URL から印を消す。リロードや URL の共有で二度目が出ないように。
  // Next のルータを通さない replaceState は再レンダリングを起こさない
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("saved")) {
      url.searchParams.delete("saved");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
  }, []);

  // 数秒で畳む
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-30 flex justify-center px-4 print:hidden"
    >
      <p className="rounded-full bg-gray-900/90 px-4 py-2 text-white shadow-lg">
        {message}
      </p>
    </div>
  );
}
