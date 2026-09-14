"use client";

import { useEffect, type RefObject } from "react";
import { persistDraft } from "@/lib/memoDraft";

// 下書きの保存は打鍵のたびではなく少し待ってから (連打で localStorage を叩かない)
const DRAFT_SAVE_DELAY_MS = 400;

// 編集のたびに下書きを退避する (少し待ってから)。初期値に戻れば消す
// (src/lib/memoDraft.ts、docs/87-編集競合対策計画.md §2-6)。
//
// 打鍵のたびに予約し直し、最後の変更から DRAFT_SAVE_DELAY_MS 後に 1 回だけ書く。
// 2 つの ref は**読む瞬間が違う**:
//   readyRef … 予約する瞬間に読む。復元の判定が済むまでは予約しない
//              (先に保存が走ると、これから読む下書きを「初期値と同じ」として消しかねない)
//   syncedRef … 書く瞬間に読む。比較の基準は「最後にサーバと揃えた本文」で、
//               揃え直した本文に戻ったら下書きは要らない
export function useDraftAutosave({
  draftKey,
  value,
  base,
  initialValue,
  readyRef,
  syncedRef,
}: {
  // 渡されなければ何もしない (下書きを持たない画面)
  draftKey: string | undefined;
  value: string;
  base: string;
  // サーバから届いた本文。本文を書くのには使わないが、これが動いたときも
  // 予約し直す (MemoEditor から分ける前の依存をそのまま保つ)
  initialValue: string;
  readyRef: RefObject<boolean>;
  syncedRef: RefObject<{ text: string }>;
}): void {
  useEffect(() => {
    if (!draftKey || !readyRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      try {
        persistDraft(
          window.localStorage,
          draftKey,
          value,
          syncedRef.current.text,
          base,
          Date.now(),
        );
      } catch {
        // 書けない環境 (容量・プライベートモード) では諦める
      }
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftKey, value, base, initialValue, readyRef, syncedRef]);
}
