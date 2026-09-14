"use client";

import type { RefObject } from "react";
import { BusyNotice } from "@/components/chrome/BusyNotice";

// カメラビューと中央のガイド枠 (= 実質センタークロップ)。
// max-w を視界の高さ (dvh) でも縛るのは ScannerModal と同じ理由 —
// スマホ横持ちで映像が縦に溢れると、下のシャッターが画面外に落ちて
// スクロールしないと押せなくなる (docs/31 §12)
export function CameraViewport({
  videoRef,
  preparing,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  // モデルの準備待ちを映像の上に出すか
  preparing: boolean;
}) {
  return (
    <div className="relative w-full max-w-[min(28rem,75dvh)]">
      <video
        ref={videoRef}
        playsInline
        muted
        className="w-full rounded bg-black"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="aspect-square h-auto w-3/4 rounded-lg border-2 border-white/80" />
      </div>
      {preparing && (
        // カメラ映像の上に白文字だけだと埋もれて「固まった」と誤解される。
        // 初回は数十 MB のモデル取得で待ちが長いので、赤背景で明示する
        <BusyNotice
          aria-live="polite"
          className="absolute inset-x-2 bottom-2 text-center"
        >
          モデルを準備しています (初回のみ)…
        </BusyNotice>
      )}
    </div>
  );
}
