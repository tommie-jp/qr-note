"use client";

import type { ReactNode } from "react";
import { usePaneMode } from "@/components/panes/PaneModeProvider";
import { CollapsedPaneTabs } from "@/components/panes/CollapsedPaneTabs";

// PaneModeProvider から分けた (docs/128 §3-4)。端のタブ (CollapsedPaneTabs) は
// usePaneMode を読むので、provider と同じファイルに置くと互いに import し合う
//
// 一覧側のペインの根。data-panes … 選ばれている構成 (docs/86 §4-9)。
// globals.css が「3 / 2 なら幅に関係なくペインの積み方」を決めるのに使う。
// **サーバの値ではなく見せている構成を付ける** (docs/86 §4-18) — 押した瞬間に
// 器の積み方を変えるため
export function ResultsPaneRoot({ children }: { children: ReactNode }) {
  const { mode } = usePaneMode();
  return (
    <div data-results-pane data-panes={mode} className="space-y-2">
      {children}
      {/* 隠したペインのタブ。画面の端に半分残す (docs/86 §4-21) */}
      <CollapsedPaneTabs />
    </div>
  );
}
