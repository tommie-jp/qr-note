"use client";

import type { ReactNode } from "react";
import { useSwitchingView } from "@/lib/prefs/pendingViewMode";

// 表示モードの切替中、一覧を薄くする器 (docs/118 §10 案 D)。
//
// 表示モードの釦を押してから一覧が描き直されるまで、本番では回線の往復
// 1 回ぶん (150〜270ms) 一覧が何も変わらず、「押したのに遅い」に見えていた。
// 送った先がサーバの値と違う間だけ薄くして aria-busy を立てる。描き直しが
// 届けば (view が送った先に追いつけば) 自然に戻る
export function ViewSwitchVeil({ view, children }: { view: string; children: ReactNode }) {
  const switching = useSwitchingView(view);
  return (
    <div
      aria-busy={switching || undefined}
      data-view-switching={switching ? "" : undefined}
      className={`transition-opacity duration-150 ${switching ? "opacity-50" : ""}`}
    >
      {children}
    </div>
  );
}
