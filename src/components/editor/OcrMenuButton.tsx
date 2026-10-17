"use client";

import { useRef, useState } from "react";
import { SlotMenu } from "@/components/bottombar/SlotMenu";
import { OcrIcon } from "@/components/icons";
import { SLOT_MENU_ITEM_CLASS } from "@/components/ui";
import type { OcrAllProgress } from "./hooks/useEditorOcr";

export interface OcrMenuActions {
  // 釦の文字 (progressLabels の ocrButtonLabel。処理中は件数が入る)
  label: string;
  // カーソルの近くの 1 枚を読む (従来の「後から OCR」)
  runAtCursor: () => void;
  // ノートの全画像のうち、まだ読んでいないものを読む (docs/106 §2)
  runAll: () => void;
  // メニューを開いた時点で数える「まだ読んでいない画像」の枚数
  countAll: () => number;
  // 全画像 OCR の進み具合。走っている間は釦が「中止」になる
  all: OcrAllProgress | null;
  cancelAll: () => void;
}

// 下部バーの OCR 釦 (docs/106-OCR切替と全画像OCR計画.md §2)。
// 押すと「この画像」「ノートの全画像」の 2 項目が開く。
//
// **帯 (overflow-x-auto) の外に置くこと。** 書式 (FormatMenuButton) と同じく、
// 帯の中に置くとメニューが切り取られて何も出ないように見える
export function OcrMenuButton({
  ocr,
  disabled,
  className,
}: {
  ocr: OcrMenuActions;
  disabled: boolean;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  // 開いた時点の枚数。描画のたびに本文を走査しない
  const [count, setCount] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 全画像 OCR の最中は、釦そのものを「中止」にする。止める手段が
  // メニューの奥にあると、数十枚のノートで待たされ続ける。
  // 押した後は読んでいる 1 枚を読み終えるまで止まらない (iPhone では数秒)。
  // その間は「中止中…」にして押せなくする — 変わらないと壊れて見える
  if (ocr.all !== null) {
    const { done, total, cancelling } = ocr.all;
    return (
      <button
        type="button"
        onClick={ocr.cancelAll}
        disabled={cancelling}
        className={className}
      >
        <span className="flex text-red-600">
          <OcrIcon />
        </span>
        {cancelling ? "中止中…" : `中止 ${done}/${total}`}
      </button>
    );
  }

  const toggle = () => {
    if (!open) {
      setCount(ocr.countAll());
    }
    setOpen((prev) => !prev);
  };

  const select = (run: () => void) => {
    setOpen(false);
    run();
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        disabled={disabled}
        className={className}
      >
        <span className="flex text-teal-600">
          <OcrIcon />
        </span>
        {ocr.label}
      </button>
      {open && (
        <SlotMenu
          label="OCR"
          anchorRef={buttonRef}
          onClose={() => setOpen(false)}
          align="start"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => select(ocr.runAtCursor)}
            className={SLOT_MENU_ITEM_CLASS}
          >
            この画像 (カーソルの近く)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => select(ocr.runAll)}
            disabled={count === 0}
            className={SLOT_MENU_ITEM_CLASS}
          >
            {count === 0
              ? "ノートの全画像 (未 OCR なし)"
              : `ノートの全画像 (${count} 枚)`}
          </button>
        </SlotMenu>
      )}
    </div>
  );
}
