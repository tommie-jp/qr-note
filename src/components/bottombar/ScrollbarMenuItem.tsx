"use client";

import { useState } from "react";
import { ScrollbarIcon } from "@/components/icons";
import { HEADER_MENU_ROW_CLASS } from "@/components/ui";
import { browserStorage } from "@/lib/prefs/storagePref";
import {
  DEFAULT_SCROLLBAR_MODE,
  applyScrollbarMode,
  loadScrollbarMode,
  type ScrollbarMode,
} from "@/lib/prefs/scrollbars";

// ハンバーガーメニューの「スクロールバー」(docs/11 §6-8)。出す / 隠す の 2 択。
// 端末ごとの好みなので保存先は localStorage で、ログイン状態に依らず出す
// (テキストサイズ・スキャン音と同じ)。形は撮影情報の切り替え (PhotoMetaMenuItem) と揃える

const GROUP_LABEL = "スクロールバー";
const OPTIONS: readonly { mode: ScrollbarMode; label: string }[] = [
  { mode: "shown", label: "出す" },
  { mode: "hidden", label: "隠す" },
];

// 枠 (上下 1px) と合わせて行の高さ 20px に収める
const OPTION_BUTTON_CLASS = "h-4.5 px-3 text-sm leading-none transition-colors";

export function ScrollbarMenuItem() {
  const [mode, setMode] = useState<ScrollbarMode>(() =>
    typeof window === "undefined"
      ? DEFAULT_SCROLLBAR_MODE
      : loadScrollbarMode(browserStorage()),
  );

  const pick = (next: ScrollbarMode) => {
    setMode(next);
    applyScrollbarMode(browserStorage(), next);
  };

  return (
    <div
      className={`${HEADER_MENU_ROW_CLASS} flex-wrap justify-between`}
      // 行の中を押してもメニューを閉じない (押し比べられるように)
      onClick={(event) => event.stopPropagation()}
    >
      <span className="flex items-center gap-2">
        <ScrollbarIcon />
        {GROUP_LABEL}
      </span>
      <span
        role="radiogroup"
        aria-label={GROUP_LABEL}
        className="flex shrink-0 overflow-hidden rounded border border-gray-300"
      >
        {OPTIONS.map((option) => {
          const selected = option.mode === mode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pick(option.mode)}
              className={`${OPTION_BUTTON_CLASS} ${
                selected
                  ? "bg-gray-800 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 active:bg-gray-200"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}
