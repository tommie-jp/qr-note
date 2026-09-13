"use client";

// お絵かきの画面 (docs/34-お絵かき計画.md §2)。
// 白紙、またはカーソルの近くにある自前画像を下敷きにして描き、
// 描いたものを 1 枚の画像として本文へ挿し込む。
//
// ノート編集フォームの中から開くので、body へポータルで逃がす —
// form の中に置くと、中のボタンが「更新」として送信されてしまう。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/components/modal/useEscapeKey";
import {
  DEFAULT_DRAW_COLOR,
  DEFAULT_DRAW_WIDTH,
  loadDrawPrefs,
  saveDrawPrefs,
} from "@/lib/draw/drawPrefs";
import { drawingAltText, drawingFileName } from "@/lib/draw/drawingFile";
import {
  createLayerState,
  type LayerId,
  setActive,
  toggleHidden,
} from "@/lib/draw/layers";
import { BUSY_NOTICE_CLASS, BUSY_SPINNER_CLASS } from "@/components/ui";
import { DrawLayerPanel } from "./DrawLayerPanel";
import type { DrawTool } from "./drawTools";
import { DrawToolbar } from "./DrawToolbar";
import { useDrawCanvas } from "./useDrawCanvas";
import { useStageGestures } from "./useStageGestures";

const BAR_BUTTON_CLASS =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded px-3 font-medium text-white transition active:scale-95 disabled:opacity-40 disabled:active:scale-100";

interface DrawModalProps {
  // カーソルの近くにある自前画像の URL。下敷きの候補で、無ければ null
  sourceImageUrl: string | null;
  onCancel: () => void;
  onInsert: (file: File, alt: string) => void;
}

export function DrawModal({ sourceImageUrl, onCancel, onInsert }: DrawModalProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  // 近くに画像があればそれを下敷きにして開く。要らなければ「白紙にする」で外せる
  const [useBackground, setUseBackground] = useState(sourceImageUrl !== null);
  const [tool, setTool] = useState<DrawTool>("pen");
  const [prefs, setPrefs] = useState(() =>
    typeof window === "undefined"
      ? { color: DEFAULT_DRAW_COLOR, width: DEFAULT_DRAW_WIDTH }
      : loadDrawPrefs(window.localStorage),
  );
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // セッション内レイヤ (docs/50)。保存で 1 枚に平坦化するので、この状態は
  // 画面を閉じれば消える。既定はレイヤ 1 がアクティブ・全表示
  const [layerState, setLayerState] = useState(createLayerState);
  const [isLayerPanelOpen, setLayerPanelOpen] = useState(false);

  // 拡大と送り (docs/36 §4)。2 本指とホイールはどの道具でも効き、
  // 1 本指ドラッグでの送りだけ「移動」道具に限る。
  // 2 本指の開始時には描きかけの線を捨てる — その関数は useDrawCanvas から
  // 出てくるが、useDrawCanvas はこのフックの zoom を受けるので、
  // 相互参照を ref で切る
  const cancelInputRef = useRef<() => void>(() => undefined);
  const gestures = useStageGestures({
    stageRef,
    contentRef,
    dragPanEnabled: tool === "pan",
    onTwoFingerStart: () => cancelInputRef.current(),
  });

  const {
    size,
    displayScale,
    isEmpty,
    isPreparing,
    error: canvasError,
    canUndo,
    canRedo,
    layerCounts,
    undo,
    redo,
    clear,
    exportImage,
    cancelActiveInput,
  } = useDrawCanvas({
    tool,
    color: prefs.color,
    width: prefs.width,
    backgroundUrl: useBackground ? sourceImageUrl : null,
    availableWidth: area.width,
    availableHeight: area.height,
    zoom: gestures.zoom,
    layerState,
    canvasElRef,
    containerRef: stageRef,
  });

  // ジェスチャ側 (レンダー順で先に居る) から最新の打ち切り関数を呼べるようにする
  useEffect(() => {
    cancelInputRef.current = cancelActiveInput;
  }, [cancelActiveInput]);

  // 画面の回転やキーボードの開閉で描画領域が変わっても、canvas 全体が
  // 収まるように表示だけを拡縮する (論理サイズ = 書き出す解像度は変えない)
  useEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setArea({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // **枠のスクロール量は常に 0 に保つ**。overflow: hidden でも、中の要素に
  // 焦点が移るとブラウザは「見える位置まで送る」ためにスクロールさせる
  // (文字道具は fabric の隠し textarea に焦点を当てる)。ここが 0 でなくなると
  // fabric の座標がその分ずれる (docs/36 §4-3)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const reset = () => {
      if (stage.scrollLeft !== 0 || stage.scrollTop !== 0) {
        stage.scrollLeft = 0;
        stage.scrollTop = 0;
      }
    };
    stage.addEventListener("scroll", reset);
    return () => stage.removeEventListener("scroll", reset);
  }, []);

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

  const updatePrefs = (next: { color: string; width: number }) => {
    setPrefs(next);
    if (typeof window !== "undefined") {
      saveDrawPrefs(window.localStorage, next);
    }
  };

  // アクティブ化・表示切り替えは純関数に委ねる (docs/50 §5)。
  // アクティブレイヤを隠せない規則も toggleHidden の中で守られる
  const handleSetActive = (layer: LayerId) => {
    setLayerState((previous) => setActive(previous, layer));
  };
  const handleToggleHidden = (layer: LayerId) => {
    setLayerState((previous) => toggleHidden(previous, layer));
  };
  // 道具を変えたらパネルは畳む (描画・別操作へ移るとき邪魔にならないよう。§4)
  const handleTool = (next: DrawTool) => {
    setTool(next);
    setLayerPanelOpen(false);
  };

  // 下敷きを入れ替えると器の寸法が変わり、描いた線の位置が合わなくなる。
  // 作り直す前に断る
  const toggleBackground = () => {
    if (!isEmpty && !window.confirm("描いたものは消えます。切り替えますか？")) {
      return;
    }
    setUseBackground((previous) => !previous);
  };

  const handleInsert = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const { blob, extension } = await exportImage();
      const now = new Date();
      const file = new File([blob], drawingFileName(now, extension), {
        type: blob.type,
      });
      // 挿入は呼び手 (エディタ) の仕事。ここは画面を閉じるだけ
      onInsert(file, drawingAltText(now));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setIsSaving(false);
    }
  };

  const isBusy = isPreparing || isSaving;

  // 中身の置き場所。枠に収まるうちは中央に置き、はみ出したら送った分だけ
  // 左・上へずらす (スクロールの代わり。docs/36 §4-3)
  const content = size
    ? { width: size.width * displayScale, height: size.height * displayScale }
    : { width: 0, height: 0 };
  const offset = {
    x: Math.max(0, (area.width - content.width) / 2) - gestures.pan.left,
    y: Math.max(0, (area.height - content.height) / 2) - gestures.pan.top,
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="お絵かき"
      className="fixed inset-0 z-50 flex flex-col bg-gray-900 text-white"
    >
      <div className="flex items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <h2 className="font-medium">お絵かき</h2>
        <DrawLayerPanel
          active={layerState.active}
          hidden={layerState.hidden}
          layerCounts={layerCounts}
          open={isLayerPanelOpen}
          onToggleOpen={() => setLayerPanelOpen((previous) => !previous)}
          onClose={() => setLayerPanelOpen(false)}
          onSetActive={handleSetActive}
          onToggleHidden={handleToggleHidden}
          disabled={isBusy}
        />
        <div className="ml-auto flex items-center gap-2">
          {sourceImageUrl && (
            <button
              type="button"
              onClick={toggleBackground}
              disabled={isBusy}
              className={`${BAR_BUTTON_CLASS} bg-white/15 hover:bg-white/25`}
            >
              {useBackground ? "白紙にする" : "画像に描く"}
            </button>
          )}
          <button
            type="button"
            onClick={requestClose}
            disabled={isSaving}
            className={`${BAR_BUTTON_CLASS} bg-white/15 hover:bg-white/25`}
          >
            閉じる
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        // **スクロールさせない**。canvas の上にスクロールできる親があると、
        // 指が canvas の外へ出た瞬間に fabric の座標がスクロール量ぶん飛ぶ
        // (docs/36 §4-3)。送りは中身の transform で行う。
        // touch-none は常時 — 2 本指ジェスチャをどの道具でも受けるので、
        // canvas の外 (余白) から始まるピンチもブラウザに渡さない
        className={`relative flex-1 touch-none overflow-hidden px-2 ${
          tool === "pan" ? "cursor-grab" : ""
        }`}
      >
        {/* 縮めた後の見た目の大きさを持つ枠。これが無いと、transform は
            レイアウトを変えないので中身の位置を測れない */}
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
        {isPreparing && (
          <p className="absolute inset-0 flex items-center justify-center gap-2">
            <span aria-hidden className={BUSY_SPINNER_CLASS} />
            準備しています…
          </p>
        )}
      </div>

      {(canvasError || saveError) && (
        <p aria-live="polite" className={`${BUSY_NOTICE_CLASS} mx-3 mb-2`}>
          {canvasError ?? saveError}
        </p>
      )}

      <DrawToolbar
        tool={tool}
        onTool={handleTool}
        color={prefs.color}
        onColor={(color) => updatePrefs({ ...prefs, color })}
        width={prefs.width}
        onWidth={(width) => updatePrefs({ ...prefs, width })}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onClear={clear}
        disabled={isBusy}
        zoom={gestures.zoom}
        canZoomIn={gestures.canZoomIn}
        canZoomOut={gestures.canZoomOut}
        onZoomIn={() => gestures.zoomBy(gestures.zoomStep)}
        onZoomOut={() => gestures.zoomBy(1 / gestures.zoomStep)}
        onZoomReset={gestures.resetZoom}
      />

      <div className="flex items-center gap-3 px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => void handleInsert()}
          disabled={isBusy || isEmpty}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded bg-blue-600 px-6 font-medium text-white transition active:scale-95 disabled:opacity-40 disabled:active:scale-100"
        >
          {isSaving && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
          {isSaving ? "挿入中…" : "本文に挿入"}
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default DrawModal;
