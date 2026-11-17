"use client";

import { PlaceholderRowsIcon } from "@/components/icons";
import { HEADER_MENU_ROW_CLASS } from "@/components/ui";
import {
  DEFAULT_LIST_PLACEHOLDERS,
  listPlaceholdersLabel,
  setListPlaceholders,
  stepListPlaceholders,
  useListPlaceholders,
} from "@/lib/prefs/listPlaceholders";

// ハンバーガーメニューの「一覧の枠」(docs/129 §1)。検索一覧で、続きのノートの
// 空の枠を読み込み済みの先に何件まで並べるかを − / ＋ で 1 段ずつ変える。
// 形はスキャン音 (ScanBeepMenuItem.tsx) と揃える。保存は localStorage (端末ごと)。
// 変えると開いている一覧にすぐ効く (prefs/listPlaceholders.ts の store)

// h-5 … 行の高さ (HEADER_MENU_ROW_CLASS の min-h-6) に収める
const STEP_BUTTON_CLASS =
  "inline-flex h-5 w-9 items-center justify-center rounded text-xl leading-none text-gray-700 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:text-gray-300 disabled:hover:bg-transparent";

export function ListPlaceholdersMenuItem() {
  const count = useListPlaceholders();
  const canLower = stepListPlaceholders(count, -1) !== count;
  const canRaise = stepListPlaceholders(count, 1) !== count;
  const label = listPlaceholdersLabel(count);

  return (
    // クリックをここで止める。素通しするとメニューのシートが閉じ、
    // 続けて押し比べられない (ScanBeepMenuItem と同じ扱い)
    <div
      className={`${HEADER_MENU_ROW_CLASS} flex-wrap justify-between`}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="flex items-center gap-2">
        <PlaceholderRowsIcon />
        一覧の枠
      </span>
      <span className="-mr-3 flex shrink-0 items-center">
        <button
          type="button"
          aria-label="一覧の枠を減らす"
          disabled={!canLower}
          onClick={() => setListPlaceholders(stepListPlaceholders(count, -1))}
          className={STEP_BUTTON_CLASS}
        >
          −
        </button>
        <button
          type="button"
          aria-label={`${label}。押すと${listPlaceholdersLabel(DEFAULT_LIST_PLACEHOLDERS)}に戻す`}
          onClick={() => setListPlaceholders(DEFAULT_LIST_PLACEHOLDERS)}
          className="inline-flex h-5 min-w-14 items-center justify-center rounded text-center transition-colors hover:bg-gray-100 active:bg-gray-200"
        >
          {label}
        </button>
        <button
          type="button"
          aria-label="一覧の枠を増やす"
          disabled={!canRaise}
          onClick={() => setListPlaceholders(stepListPlaceholders(count, 1))}
          className={STEP_BUTTON_CLASS}
        >
          ＋
        </button>
      </span>
      <span aria-live="polite" className="sr-only">
        一覧の枠 {label}
      </span>
    </div>
  );
}
