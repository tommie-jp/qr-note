"use client";

import { attachmentUrl } from "@/lib/images/memoImages";
import type { ViewerTarget } from "@/lib/images/viewerNav";
import { CopyImageButton } from "../markdown/CopyImageButton";
import { ModalOverlay } from "../modal/ModalOverlay";
import { useIdleWhile } from "./useIdleWhile";
import {
  IntervalButton,
  OpenNoteLink,
  PlayPauseButton,
  StepButton,
} from "./ViewerControls";
import { ViewerImage } from "./ViewerImage";

interface ImageViewerOverlayProps {
  target: ViewerTarget;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  // スライドショー (docs/117)
  playing: boolean;
  endNotice: boolean;
  onTogglePlay: () => void;
  onSettled: (name: string) => void;
}

// 再生中、触らずにこれだけ経ったら操作を隠す (絵だけを見せる)
const CONTROLS_HIDE_MS = 3000;

// 画面全体の覆いで 1 枚を見せる (docs/116 §2)。1 ペイン・ゴミ箱と、ペインの
// 「全画面」から。見た目と閉じ方はノート本文の拡大表示 (ZoomableImage) と
// 同じ — 覆いのどこを押しても閉じ、Esc でも閉じる (Esc は provider が張る)。
//
// **スライドショーの再生中だけは、覆いを押すと一時停止**にする (docs/117 §3)。
// 眺めている間にうっかり触って消えるのを防ぐ。止まった後にもう一度押せば
// 今までどおり閉じる。Esc は再生中でも閉じる
export function ImageViewerOverlay({
  target,
  onClose,
  onStep,
  playing,
  endNotice,
  onTogglePlay,
  onSettled,
}: ImageViewerOverlayProps) {
  const idle = useIdleWhile(playing, CONTROLS_HIDE_MS);
  const controlsClass = `transition-opacity duration-300 ${
    playing && idle ? "pointer-events-none opacity-0" : ""
  }`;
  return (
    <ModalOverlay variant="zoom" onClose={playing ? onTogglePlay : onClose}>
      {/* data-image-viewer … 中の釦に焦点があっても ← → を受ける目印
          (ImageViewerProvider)。contents なので配置には効かない */}
      <div data-image-viewer="" className="contents">
        <div className="relative h-full w-full">
          <ViewerImage name={target.name} onSettled={onSettled} />
        </div>
        {endNotice && (
          <p
            role="status"
            className="absolute inset-x-0 top-4 mx-auto w-fit rounded bg-black/70 px-3 py-1 text-sm text-white"
          >
            最後の画像です
          </p>
        )}
        {/* 前後は画面の左右の中ほど。画像の上に重なるが、押すのは輪の中だけ */}
        <StepButton
          dir={-1}
          onStep={onStep}
          className={`absolute top-1/2 left-2 -translate-y-1/2 ${controlsClass}`}
        />
        <StepButton
          dir={1}
          onStep={onStep}
          className={`absolute top-1/2 right-2 -translate-y-1/2 ${controlsClass}`}
        />
        <div
          className={`absolute right-4 bottom-4 flex items-center gap-2 ${controlsClass}`}
          onClick={(e) => e.stopPropagation()}
        >
          <IntervalButton />
          <PlayPauseButton playing={playing} onToggle={onTogglePlay} />
          <CopyImageButton src={attachmentUrl(target.name)} />
          <OpenNoteLink href={target.href} onClose={onClose} />
        </div>
      </div>
    </ModalOverlay>
  );
}
