"use client";

// お絵かき画面の下端 (エラーの知らせと「本文に挿入」)。
// DrawModal から切り出した (docs/128 §8-1)。

import { BusyNotice } from "@/components/chrome/BusyNotice";
import { BUSY_SPINNER_CLASS } from "@/components/ui";
import type { DrawInsert } from "./useDrawInsert";

// canvas 側のエラーを優先して 1 つだけ出す
export function DrawErrorNotice({
  canvasError,
  saveError,
}: {
  canvasError: string | null;
  saveError: string | null;
}) {
  if (!(canvasError || saveError)) {
    return null;
  }
  return (
    <BusyNotice aria-live="polite" className="mx-3 mb-2">
      {canvasError ?? saveError}
    </BusyNotice>
  );
}

interface DrawInsertBarProps {
  insert: Pick<DrawInsert, "isSaving" | "handleInsert">;
  disabled: boolean;
}

export function DrawInsertBar({ insert, disabled }: DrawInsertBarProps) {
  const { isSaving, handleInsert } = insert;
  return (
    <div className="flex items-center gap-3 px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <button
        type="button"
        onClick={() => void handleInsert()}
        disabled={disabled}
        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded bg-blue-600 px-6 font-medium text-white transition active:scale-95 disabled:opacity-40 disabled:active:scale-100"
      >
        {isSaving && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
        {isSaving ? "挿入中…" : "本文に挿入"}
      </button>
    </div>
  );
}
