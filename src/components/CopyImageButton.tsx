"use client";

import { useEffect, useRef, useState } from "react";
import { canCopyImage, copyImageToClipboard } from "@/lib/clipboard/clipboardImage";
import { IMAGE_OVERLAY_BUTTON_CLASS } from "./ui";

// 結果の印 (コピー済・失敗) を出しておく時間 (CodeBlock と揃える)。
// **失敗も時間で消す。** ここはラベルがボタンの文字そのものなので、
// 「失敗」のまま残すと押せる物に見えなくなる
const RESULT_LABEL_MS = 2000;

type CopyState = "idle" | "busy" | "copied" | "failed";

const LABEL: Record<CopyState, string> = {
  idle: "コピー",
  busy: "…",
  copied: "✓ コピー済",
  failed: "失敗",
};

// 拡大表示した画像をクリップボードへ載せるボタン
// (docs/92-クリップボード連携計画.md §3)。
//
// **iPhone で取り込んだ画像を Windows から取り出す出口。** デスクトップの
// 右クリック「画像をコピー」でも同じことはできるが、standalone の PWA には
// 右クリックメニューが無く、iPhone の長押しも覆いの中では出ないことがある。
// 押せば必ず同じ結果になる口を 1 つ置く。
//
// **出せない環境では描かない。** CodeBlock のコピーボタンは常に出しているが、
// あちらは本文の中で場所が決まっており、後から生えると画面が跳ねる。こちらは
// 拡大表示 (ユーザーが押して初めて作られる覆いの中) なので、跳ねる先が無い。
export function CopyImageButton({ src }: { src: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  // 出せない環境と、復号したシークレット断片 (blob:) には出さない
  if (!canCopyImage(src)) {
    return null;
  }

  const showResult = (next: CopyState) => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    setState(next);
    timer.current = setTimeout(() => setState("idle"), RESULT_LABEL_MS);
  };

  const copy = () => {
    setState("busy");
    // **await を挟まない。** 取得と変換は ClipboardItem の中で待たせる
    // (clipboard/clipboardImage.ts)。ここで待つと Safari が操作の外と見なして弾く
    copyImageToClipboard(src)
      .then(() => showResult("copied"))
      .catch((cause: unknown) => {
        console.error("画像をコピーできませんでした", cause);
        showResult("failed");
      });
  };

  return (
    <button
      type="button"
      onClick={copy}
      disabled={state === "busy"}
      aria-label="画像をクリップボードにコピー"
      className={`${IMAGE_OVERLAY_BUTTON_CLASS} px-4 py-3 text-sm font-medium`}
    >
      {LABEL[state]}
    </button>
  );
}
