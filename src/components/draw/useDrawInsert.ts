"use client";

// 描いたものを書き出して呼び手に渡す (docs/34-お絵かき計画.md §2)。
// DrawModal から切り出した (docs/128 §8-1)。

import { useState } from "react";
import { drawingAltText, drawingFileName } from "@/lib/draw/drawingFile";
import { errorText } from "@/lib/errorMessage";

export interface DrawInsert {
  isSaving: boolean;
  saveError: string | null;
  handleInsert: () => Promise<void>;
}

export function useDrawInsert(
  exportImage: () => Promise<{ blob: Blob; extension: string }>,
  onInsert: (file: File, alt: string) => void,
): DrawInsert {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleInsert = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const { blob, extension } = await exportImage();
      const now = new Date();
      const file = new File([blob], drawingFileName(now, extension), {
        type: blob.type,
      });
      // 挿入は呼び手 (エディタ) の仕事。ここは画面を閉じるだけ
      onInsert(file, drawingAltText(now));
    } catch (e) {
      setSaveError(errorText(e));
      setIsSaving(false);
    }
  };

  return { isSaving, saveError, handleInsert };
}
