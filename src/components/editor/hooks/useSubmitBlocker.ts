"use client";

import { useEffect, type RefObject } from "react";

// 編集エリアを囲む <form> との繋ぎ (docs/93-リファクタリング計画.md §5-1)。
//
// reason が null でない間、囲みの form の送信を止めて理由を知らせる。
// アップロード / OCR / 録音・録画の完了前に送信すると、画像リンクや OCR 結果、
// 録音・録画そのものが memo に入らないため (理由の文は lib/editor/busyReason.ts)。
//
// form は編集エリア (wrapperRef) から辿る — こちらは form の DOM 内にある
export function useSubmitBlocker({
  wrapperRef,
  reason,
  onBlocked,
}: {
  wrapperRef: RefObject<HTMLElement | null>;
  reason: string | null;
  onBlocked: (reason: string) => void;
}): { submitForm: () => void } {
  useEffect(() => {
    if (reason === null) {
      return;
    }
    const form = wrapperRef.current?.closest("form");
    if (!form) {
      return;
    }
    const blockSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      onBlocked(reason);
    };
    form.addEventListener("submit", blockSubmit);
    return () => form.removeEventListener("submit", blockSubmit);
  }, [wrapperRef, reason, onBlocked]);

  // 「更新」は下部バーへ portal されており、DOM は form の外に出る。native の
  // submit ボタンの関連付けは効かないので、囲みの form を明示的に送信する。
  // 処理中なら上の submit リスナーが止める (requestSubmit は submit を発火する)
  const submitForm = () => {
    wrapperRef.current?.closest("form")?.requestSubmit();
  };

  return { submitForm };
}
