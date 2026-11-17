"use client";

// お絵かきの描く枠 (canvas を拡縮・送りして見せる所)。
// DrawModal から切り出した (docs/128 §8-1)。

import type { RefObject } from "react";
import type { CanvasSize } from "@/lib/draw/drawingFile";
import type { PanOffset } from "@/lib/draw/zoom";
import { BUSY_SPINNER_CLASS } from "@/components/ui";
import type { DrawCanvasApi } from "./useDrawCanvas";
import type { StageArea } from "./useDrawSurface";

interface DrawStageProps {
  stageRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  canvasElRef: RefObject<HTMLCanvasElement | null>;
  canvas: Pick<DrawCanvasApi, "size" | "displayScale" | "isPreparing">;
  area: StageArea;
  pan: PanOffset;
  isPanTool: boolean;
}

// 中身の置き場所。枠に収まるうちは中央に置き、はみ出したら送った分だけ
// 左・上へずらす (スクロールの代わり。docs/36 §4-3)
function contentOffset(
  size: CanvasSize | null,
  displayScale: number,
  area: StageArea,
  pan: PanOffset,
) {
  const content = size
    ? { width: size.width * displayScale, height: size.height * displayScale }
    : { width: 0, height: 0 };
  return {
    x: Math.max(0, (area.width - content.width) / 2) - pan.left,
    y: Math.max(0, (area.height - content.height) / 2) - pan.top,
  };
}

interface ScaledCanvasProps {
  contentRef: RefObject<HTMLDivElement | null>;
  canvasElRef: RefObject<HTMLCanvasElement | null>;
  size: CanvasSize | null;
  displayScale: number;
  offset: { x: number; y: number };
}

// 縮めた後の見た目の大きさを持つ枠と、その中で縮める canvas
function ScaledCanvas({ contentRef, canvasElRef, size, displayScale, offset }: ScaledCanvasProps) {
  return (
    // 縮めた後の見た目の大きさを持つ枠。これが無いと、transform は
    // レイアウトを変えないので中身の位置を測れない
    <div
      ref={contentRef}
      style={
        size
          ? {
              width: size.width * displayScale,
              height: size.height * displayScale,
              // 収まっているうちは中央に、はみ出したら送った分だけずらす
              transform: `translate(${offset.x}px, ${offset.y}px)`,
            }
          : undefined
      }
    >
      <div
        style={
          size
            ? {
                width: size.width,
                height: size.height,
                transform: `scale(${displayScale})`,
                transformOrigin: "top left",
              }
            : undefined
        }
      >
        <canvas ref={canvasElRef} />
      </div>
    </div>
  );
}

export function DrawStage({
  stageRef,
  contentRef,
  canvasElRef,
  canvas,
  area,
  pan,
  isPanTool,
}: DrawStageProps) {
  const { size, displayScale, isPreparing } = canvas;
  return (
    <div
      ref={stageRef}
      // **スクロールさせない**。canvas の上にスクロールできる親があると、
      // 指が canvas の外へ出た瞬間に fabric の座標がスクロール量ぶん飛ぶ
      // (docs/36 §4-3)。送りは中身の transform で行う。
      // touch-none は常時 — 2 本指ジェスチャをどの道具でも受けるので、
      // canvas の外 (余白) から始まるピンチもブラウザに渡さない
      className={`relative flex-1 touch-none overflow-hidden px-2 ${
        isPanTool ? "cursor-grab" : ""
      }`}
    >
      <ScaledCanvas
        contentRef={contentRef}
        canvasElRef={canvasElRef}
        size={size}
        displayScale={displayScale}
        offset={contentOffset(size, displayScale, area, pan)}
      />
      {isPreparing && (
        <p className="absolute inset-0 flex items-center justify-center gap-2">
          <span aria-hidden className={BUSY_SPINNER_CLASS} />
          準備しています…
        </p>
      )}
    </div>
  );
}
