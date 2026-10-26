"use client";

import { attachmentUrl } from "@/lib/images/memoImages";
import type { ViewerTarget } from "@/lib/images/viewerNav";
import { CopyImageButton } from "../markdown/CopyImageButton";
import { ModalOverlay } from "../modal/ModalOverlay";
import { OpenNoteLink, StepButton } from "./ViewerControls";
import { ViewerImage } from "./ViewerImage";

interface ImageViewerOverlayProps {
  target: ViewerTarget;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
}

// 画面全体の覆いで 1 枚を見せる (docs/116 §2)。1 ペイン・ゴミ箱と、ペインの
// 「全画面」から。見た目と閉じ方はノート本文の拡大表示 (ZoomableImage) と
// 同じ — 覆いのどこを押しても閉じ、Esc でも閉じる (Esc は provider が張る)
export function ImageViewerOverlay({
  target,
  onClose,
  onStep,
}: ImageViewerOverlayProps) {
  return (
    <ModalOverlay variant="zoom" onClose={onClose}>
      {/* data-image-viewer … 中の釦に焦点があっても ← → を受ける目印
          (ImageViewerProvider)。contents なので配置には効かない */}
      <div data-image-viewer="" className="contents">
        <div className="relative h-full w-full">
          <ViewerImage name={target.name} />
        </div>
        {/* 前後は画面の左右の中ほど。画像の上に重なるが、押すのは輪の中だけ */}
        <StepButton
          dir={-1}
          onStep={onStep}
          className="absolute top-1/2 left-2 -translate-y-1/2"
        />
        <StepButton
          dir={1}
          onStep={onStep}
          className="absolute top-1/2 right-2 -translate-y-1/2"
        />
        <div
          className="absolute right-4 bottom-4 flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <CopyImageButton src={attachmentUrl(target.name)} />
          <OpenNoteLink href={target.href} onClose={onClose} />
        </div>
      </div>
    </ModalOverlay>
  );
}
