"use client";

import type { ReactNode } from "react";
import { MoreIcon } from "@/components/icons";
import { useNoteChrome } from "@/components/notechrome/NoteChromeProvider";
import { CONTENT_WIDTH_CLASS } from "@/components/ui";

// 呼び口 (docs/108-ノート全画面表示計画.md §2)。上端の行の、閉じると
// 全画面で開くの間に差し込まれる。
//
// ⋯ は行メニュー (docs/107) と同じ輪で囲んだ形。iPhone の利用者に馴染みが
// あり、輪がボタンの縁を兼ねる。badge は畳んでいる間も知らせたい状態
// (公開中) で、⋯ の左に出す
export function NoteChromeTrigger({ badge }: { badge?: ReactNode }) {
  const chrome = useNoteChrome();
  if (chrome === null) {
    return null;
  }
  return (
    <>
      {badge}
      <button
        type="button"
        aria-label="ノートの操作"
        aria-expanded={chrome.revealed}
        onClick={chrome.toggle}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-gray-600 transition-colors hover:text-gray-900 active:bg-gray-200"
      >
        <MoreIcon />
      </button>
    </>
  );
}

// 重ねる面。行の直下に absolute で被さり、本文を押し下げない (§3-1)。
//
// 高さは「ノートが見えている高さ」から行のぶんを引いた所まで。下部ペイン
// (45dvh) では操作を全部積むと収まらないことがあるので、面の中で送る。
// overscroll-contain … 面を送り切った勢いで後ろの本文が動かないように
export function NoteChromePanel({ children }: { children: ReactNode }) {
  return (
    <div
      data-note-chrome-overlay=""
      className="absolute inset-x-0 top-full z-20 max-h-[calc(var(--note-view-h)-3.5rem)] overflow-y-auto overscroll-contain border-y border-gray-300 bg-white shadow-lg"
    >
      <div className={`mx-auto px-safe pt-1 pb-3 ${CONTENT_WIDTH_CLASS}`}>
        {children}
      </div>
    </div>
  );
}
