"use client";

import { useEffect } from "react";
import { installClientLogCapture } from "@/lib/logging/clientCapture";
import { sendClientLogs } from "@/lib/logging/clientTransport";

// ブラウザのログ拾いを仕掛けるだけの部品 (docs/30-ブラウザログ計画.md §1)。
// 何も描かない。layout に置いて全ページで効かせる。
//
// **外さない (cleanup を返さない)**。React StrictMode の二重実行や
// 画面遷移で外すと、その隙間に起きたエラーを取りこぼす。install の側が
// 1 重を保つので、何度呼ばれても包みは増えない。
export function ClientLogCapture() {
  useEffect(() => {
    installClientLogCapture({ send: sendClientLogs });
  }, []);

  return null;
}
