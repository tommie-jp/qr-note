"use client";

import { useEffect } from "react";
import { debugEnabledFor } from "@/lib/logging/debugConsole";
import { isDebugConsoleOn, setDebugConsole } from "@/lib/logging/erudaConsole";

// ?debug=1 で eruda を出す (docs/30-ブラウザログ計画.md §2)。何も描かない。
//
// **ログイン中かどうかに関わらず layout に置く**。パスキーで入れないなど
// 「ログインできない不具合」こそブラウザ側にしか手掛かりが無く、そのとき
// ログ転送 (ClientLogCapture) は 401 で運べない。
export function DebugConsole() {
  useEffect(() => {
    // 覚えている印を URL が上書きする。SPA 遷移ではクエリが消えるので、
    // 印のほうが基本で、?debug= はその印を書き換える指示にあたる
    const enabled = debugEnabledFor(window.location.search, isDebugConsoleOn());
    setDebugConsole(enabled).catch((error: unknown) => {
      // 読み込みに失敗したことは残す (転送に乗って /logs に出る)。
      // 握りつぶすと「?debug=1 を付けたのに出ない」の原因が消える
      console.error("デバッグコンソールを読み込めませんでした", error);
    });
  }, []);

  return null;
}
