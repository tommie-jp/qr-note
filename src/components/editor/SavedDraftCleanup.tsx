"use client";

import { useEffect } from "react";
import { clearDraft } from "@/lib/prefs/memoDraft";

// 保存が済んだ番号の下書きを消す。更新 → /item/:no?saved= の着地点 (ItemView) で
// SavedToast と並べて置く。編集画面 (MemoEditor) は保存の成否を知る前に
// redirect で消えるので、下書きを片付けられるのは着地した側だけ。
//
// 消さずにいると、保存済みの本文が下書きとして残り続け、後で本文が別の経路で
// 変わったときに古い基点のまま復元されて競合バナーになっていた (2026-09-17 に修正)
export function SavedDraftCleanup({ draftKey }: { draftKey: string }) {
  useEffect(() => {
    clearDraft(window.localStorage, draftKey);
  }, [draftKey]);

  return null;
}
