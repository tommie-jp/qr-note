// フルスクリーンの録画モーダル (docs/16-録画の近接フォーカス計画.md)。
// カメラアプリ風に、プレビュー/録画中は画面いっぱいに映像を出し、下部バーに
// 録画・停止と各種カメラ操作を並べる。録画の state・操作は useVideoRecording が
// すべて持つので、ここは表示と配置だけを引き受ける (ScannerModal と同じ流儀で
// createPortal + fixed inset-0)。

"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatElapsed } from "@/lib/progressLabels";
import { cameraControlClass } from "./cameraControlButton";
import type { VideoRecordingState } from "./useVideoRecording";

export interface VideoRecordModalProps {
  video: VideoRecordingState;
}

export function VideoRecordModal({ video }: VideoRecordModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isOpen = video.phase !== "idle";
  const recording = video.phase === "recording";

  // Escape ハンドラが毎レンダリング張り替わらないよう、最新 state は ref で読む
  const videoStateRef = useRef(video);
  useEffect(() => {
    videoStateRef.current = video;
  });

  // Escape で閉じる。プレビュー中は取消、録画中は停止して保存する
  // (撮った録画を誤操作で失わせない。不要なら本文から 1 行消せばよい)
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      const v = videoStateRef.current;
      if (v.phase === "recording") {
        v.stop();
      } else {
        v.cancelPreview();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // プレビュー stream を <video> に繋ぐ。MediaStream は srcObject にしか渡せず
  // 属性では渡せないので ref 経由で設定する。カメラ切替で stream が変わっても
  // ここが追従する
  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      el.srcObject = video.previewStream;
    }
  }, [video.previewStream]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-label="録画"
      className="fixed inset-0 z-50 flex flex-col overscroll-contain bg-black text-white"
    >
      {/* 上部バー: プレビューは閉じる。録画中の経過時間は下の●の上に出す
          (min-h-14 は録画中も空で確保し、映像の高さを揺らさない) */}
      <div className="flex min-h-14 items-center justify-between p-3">
        {!recording && (
          <button
            type="button"
            onClick={video.cancelPreview}
            aria-label="録画を閉じる"
            className="rounded bg-white/20 px-4 py-2 font-medium"
          >
            ✕ 閉じる
          </button>
        )}
      </div>

      {/* 映像は object-contain 相当 (max-h/max-w)。上下黒帯が出ても、録れる範囲と
          見える範囲を一致させる (cover はズレる)。内側カメラは鏡像で見せる —
          録画ファイル自体は反転しない (docs/16) */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`max-h-full max-w-full ${
            video.facing === "user" ? "-scale-x-100" : ""
          }`}
        />
      </div>

      {/* 下部バー: 左=レンズ切替 (録画中は不可) / 中央=録画・停止 /
          右=トーチ・ズーム (録画中も可)。safe-area でホームバーに潜らせない */}
      <div className="flex items-end justify-between gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* 内側/外側カメラ切替。ラベルは切り替え先を示す。録画中はトラックを
              差し替えられないので不可 */}
          <button
            type="button"
            onClick={video.toggleFacing}
            disabled={recording}
            className={cameraControlClass(false)}
          >
            {video.facing === "environment" ? "内カメラ" : "外カメラ"}
          </button>
          {/* 近接 = 超広角レンズ (iOS のマクロ相当)。外側で超広角を持つ端末のみ */}
          {video.facing === "environment" && video.canNearFocus && (
            <button
              type="button"
              onClick={video.toggleNearFocus}
              aria-pressed={video.nearFocus}
              disabled={recording}
              className={cameraControlClass(video.nearFocus)}
            >
              {video.nearFocus ? "近接 ON" : "近接"}
            </button>
          )}
        </div>

        {/* 中央: 経過時間を大ボタンの真上に出す。ボタンはプレビュー=赤●、
            録画中=赤■ (押せば止まると判る) */}
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          {recording && (
            <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
              <span
                aria-hidden
                className="size-2 animate-pulse rounded-full bg-red-600"
              />
              {formatElapsed(video.elapsedMs)}
            </span>
          )}
          <button
            type="button"
            onClick={recording ? video.stop : video.startRecording}
            aria-label={recording ? "録画を停止して保存" : "録画開始"}
            className="flex size-16 items-center justify-center rounded-full border-4 border-white"
          >
            {recording ? (
              <span aria-hidden className="size-6 rounded-sm bg-red-600" />
            ) : (
              <span aria-hidden className="size-12 rounded-full bg-red-600" />
            )}
          </button>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {/* トーチ・ズームはトラックそのままで効くので録画中も操作できる */}
          {video.canTorch && (
            <button
              type="button"
              onClick={video.toggleTorch}
              aria-pressed={video.torchOn}
              className={cameraControlClass(video.torchOn)}
            >
              {video.torchOn ? "ライト ON" : "ライト"}
            </button>
          )}
          {video.zoomLevels.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => video.setZoom(level)}
              aria-pressed={video.zoom === level}
              className={cameraControlClass(video.zoom === level)}
            >
              {level}x
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
