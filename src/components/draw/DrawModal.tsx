"use client";

// お絵かきの画面 (docs/34-お絵かき計画.md §2)。
// 白紙、またはカーソルの近くにある自前画像を下敷きにして描き、
// 描いたものを 1 枚の画像として本文へ挿し込む。
//
// ノート編集フォームの中から開くので、body へポータルで逃がす —
// form の中に置くと、中のボタンが「更新」として送信されてしまう。

import { useRef } from "react";
import { createPortal } from "react-dom";
import { DrawHeaderBar } from "./DrawHeaderBar";
import { DrawErrorNotice, DrawInsertBar } from "./DrawInsertBar";
import { DrawStage } from "./DrawStage";
import { DrawToolbar, type DrawToolbarProps } from "./DrawToolbar";
import type { DrawCanvasApi } from "./useDrawCanvas";
import { useDrawCloseGuard } from "./useDrawCloseGuard";
import { useDrawInsert } from "./useDrawInsert";
import { type DrawSession, useDrawSession } from "./useDrawSession";
import { useDrawSurface } from "./useDrawSurface";
import type { StageGestures } from "./useStageGestures";

interface DrawModalProps {
  // カーソルの近くにある自前画像の URL。下敷きの候補で、無ければ null
  sourceImageUrl: string | null;
  onCancel: () => void;
  onInsert: (file: File, alt: string) => void;
}

// 道具立ての props を、選択状態・canvas・拡大の 3 つから組む
function toolbarProps(
  session: DrawSession,
  canvas: DrawCanvasApi,
  gestures: StageGestures,
  disabled: boolean,
): DrawToolbarProps {
  const { prefs, updatePrefs } = session;
  return {
    tool: session.tool,
    onTool: session.selectTool,
    color: prefs.color,
    onColor: (color) => updatePrefs({ ...prefs, color }),
    width: prefs.width,
    onWidth: (width) => updatePrefs({ ...prefs, width }),
    canUndo: canvas.canUndo,
    canRedo: canvas.canRedo,
    onUndo: canvas.undo,
    onRedo: canvas.redo,
    onClear: canvas.clear,
    disabled,
    zoom: gestures.zoom,
    canZoomIn: gestures.canZoomIn,
    canZoomOut: gestures.canZoomOut,
    onZoomIn: () => gestures.zoomBy(gestures.zoomStep),
    onZoomOut: () => gestures.zoomBy(1 / gestures.zoomStep),
    onZoomReset: gestures.resetZoom,
  };
}

export function DrawModal({ sourceImageUrl, onCancel, onInsert }: DrawModalProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const session = useDrawSession(sourceImageUrl);
  const { canvas, gestures, area } = useDrawSurface({
    stageRef,
    contentRef,
    canvasElRef,
    session,
    backgroundUrl: session.useBackground ? sourceImageUrl : null,
  });
  const insert = useDrawInsert(canvas.exportImage, onInsert);
  const requestClose = useDrawCloseGuard(canvas.isEmpty, onCancel);
  const isBusy = canvas.isPreparing || insert.isSaving;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="お絵かき"
      className="fixed inset-0 z-50 flex flex-col bg-gray-900 text-white"
    >
      <DrawHeaderBar
        session={session}
        sourceImageUrl={sourceImageUrl}
        layerCounts={canvas.layerCounts}
        isEmpty={canvas.isEmpty}
        isBusy={isBusy}
        isSaving={insert.isSaving}
        onClose={requestClose}
      />
      <DrawStage
        stageRef={stageRef}
        contentRef={contentRef}
        canvasElRef={canvasElRef}
        canvas={canvas}
        area={area}
        pan={gestures.pan}
        isPanTool={session.tool === "pan"}
      />
      <DrawErrorNotice canvasError={canvas.error} saveError={insert.saveError} />
      <DrawToolbar {...toolbarProps(session, canvas, gestures, isBusy)} />
      <DrawInsertBar insert={insert} disabled={isBusy || canvas.isEmpty} />
    </div>,
    document.body,
  );
}

export default DrawModal;
