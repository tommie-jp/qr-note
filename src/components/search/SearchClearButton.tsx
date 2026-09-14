"use client";

import { ClearIcon } from "@/components/icons";

// 検索語を消す ✕ (docs/62 §6)。標準のものは iOS Safari と
// Android Chrome に無いので自前で持つ。窓の右端に重ねる
// (窓の pr-9 がこのぶんを空けている。SearchForm)。
//
// mousedown で preventDefault … これが無いと押した瞬間に入力欄が
// blur し、onBlur がドロップダウンを閉じてしまう (★/☆ と同じ手)
export function SearchClearButton({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="検索語を消す"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClear}
      className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 active:bg-gray-200"
    >
      <ClearIcon />
    </button>
  );
}
