"use client";

import { useEffect } from "react";
import { installPerf } from "@/lib/logging/perfClient";

// 速度計測の観測を仕掛ける (docs/119-速度計測ログ計画.md §3)。何も描かない。
// root layout (chrome/AppSideEffects.tsx) が**計測中だけ**置く。置かれていなければ
// 測る場所 (検索窓・同期…) の呼び出しはどれも何もしない (logging/perfClient.ts)
export function PerfReport() {
  useEffect(() => installPerf(), []);
  return null;
}
