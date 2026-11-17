"use client";

// お絵かき画面を閉じる前の確認と Escape (docs/34-お絵かき計画.md §2)。
// DrawModal から切り出した (docs/128 §8-1)。

import { useCallback } from "react";
import { useEscapeKey } from "@/components/modal/useEscapeKey";

// 閉じる口を返す。描いたものがあれば確かめてから閉じる
export function useDrawCloseGuard(isEmpty: boolean, onCancel: () => void): () => void {
  // isEmpty を読む。閉じる前の確認を出す条件が変わるので追う
  // (Escape のリスナーもこれに合わせて張り直る)
  const requestClose = useCallback(() => {
    if (!isEmpty && !window.confirm("描いたものは保存されません。閉じますか？")) {
      return;
    }
    onCancel();
  }, [isEmpty, onCancel]);

  const closeOnEscape = useCallback(() => {
    // 文字道具の編集中は fabric の隠し textarea に焦点がある。
    // そこでの Esc は「文字の入力をやめる」なので、画面は閉じない
    if (document.activeElement instanceof HTMLTextAreaElement) {
      return;
    }
    requestClose();
  }, [requestClose]);
  useEscapeKey(closeOnEscape);

  return requestClose;
}
