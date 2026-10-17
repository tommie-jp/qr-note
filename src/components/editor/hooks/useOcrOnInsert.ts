"use client";

import { useState } from "react";
import {
  loadOcrOnInsertPref,
  saveOcrOnInsertPref,
} from "@/lib/prefs/ocrOnInsert";
import { browserStorage } from "@/lib/prefs/storagePref";

export interface OcrOnInsert {
  ocrOnInsert: boolean;
  toggleOcrOnInsert: () => void;
}

// 画像を入れたときに OCR するか (docs/106-OCR切替と全画像OCR計画.md §1)。
// 端末に覚える。読むのは insertFiles の既定値だけ — 明示で ocr を渡す
// 呼び出し (お絵かきの false) はこの設定に左右されない
export function useOcrOnInsert(): OcrOnInsert {
  // この部品は ssr: false で読み込まれる (MemoEditor.tsx) ので、初期値を
  // localStorage から同期に読んでも hydration はずれない
  const [ocrOnInsert, setOcrOnInsert] = useState(() =>
    loadOcrOnInsertPref(browserStorage()),
  );

  const toggleOcrOnInsert = () => {
    const next = !ocrOnInsert;
    setOcrOnInsert(next);
    saveOcrOnInsertPref(browserStorage(), next);
  };

  return { ocrOnInsert, toggleOcrOnInsert };
}
