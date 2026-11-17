"use client";

// fabric の canvas の作成と後始末 (docs/34-お絵かき計画.md §3)。
// useDrawCanvas から切り出した (docs/128 §8-1)。背景が変わったときだけ
// canvas を作り直し、道具・履歴のイベントを 1 度だけ束ねる。

import type * as fabric from "fabric";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import { blankCanvasSize, type CanvasSize } from "@/lib/draw/drawingFile";
import type { LayerState } from "@/lib/draw/layers";
import type { DrawTool } from "./drawTools";
import { createDrawingCanvas, loadCanvasBase } from "./drawingCanvasSetup";
import type { ShapeToolHandle } from "./shapeTool";
import { type DrawingCanvasWiring, wireDrawingCanvas } from "./wireDrawingCanvas";

export interface CanvasStatus {
  size: CanvasSize | null;
  isPreparing: boolean;
  error: string | null;
  setSize: Dispatch<SetStateAction<CanvasSize | null>>;
  setIsPreparing: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

// 器の寸法・準備中・エラー。ブラシの持ち替え (useFabricBrush) が準備の完了を
// 待つので、初期化の effect より先に用意する
export function useCanvasStatus(): CanvasStatus {
  const [size, setSize] = useState<CanvasSize | null>(null);
  const [isPreparing, setIsPreparing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  return { size, isPreparing, error, setSize, setIsPreparing, setError };
}

type LatestRef<T> = Readonly<RefObject<T>>;

interface LatestRefs {
  toolRef: LatestRef<DrawTool>;
  colorRef: LatestRef<string>;
  widthRef: LatestRef<number>;
  fitScaleRef: LatestRef<number>;
  displayScaleRef: LatestRef<number>;
  layerStateRef: LatestRef<LayerState>;
}

interface LifecycleParams extends LatestRefs {
  backgroundUrl: string | null;
  canvasElRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  fcRef: RefObject<fabric.Canvas | null>;
  shapeToolRef: RefObject<ShapeToolHandle | null>;
  suppressTapRef: RefObject<boolean>;
  status: CanvasStatus;
  scheduleSnapshot: () => void;
  suspendSnapshots: () => void;
  resumeSnapshots: (commit: boolean) => void;
  resetHistory: () => void;
  cancelScheduledSnapshot: () => void;
  refreshStats: () => void;
  releaseEraser: () => void;
}

type WiringCallbacks = Pick<
  DrawingCanvasWiring,
  "recordChange" | "suspendRecording" | "resumeRecording" | "onError"
>;

// 1 度だけ束ねるハンドラが、そのときどきの道具・色・太さを控えから読む口
function wiringFrom(
  fc: fabric.Canvas,
  refs: LatestRefs & {
    fcRef: RefObject<fabric.Canvas | null>;
    suppressTapRef: RefObject<boolean>;
  },
  callbacks: WiringCallbacks,
): DrawingCanvasWiring {
  return {
    getTool: () => refs.toolRef.current,
    getColor: () => refs.colorRef.current,
    getWidth: () => refs.widthRef.current,
    getFitScale: () => refs.fitScaleRef.current,
    getDisplayScale: () => refs.displayScaleRef.current,
    getActiveLayer: () => refs.layerStateRef.current.active,
    isTapSuppressed: () => refs.suppressTapRef.current,
    clearTapSuppression: () => {
      refs.suppressTapRef.current = false;
    },
    isCurrent: () => refs.fcRef.current === fc,
    ...callbacks,
  };
}

// 白紙の器は開いた時点の枠だけで決める。描いている最中に画面を回して
// 器を作り直すと、それまでの線の位置がずれるため、測るのは 1 度きり
function loadBaseFor(container: HTMLElement | null, backgroundUrl: string | null) {
  const rect = container?.getBoundingClientRect();
  const blankSize = blankCanvasSize(rect?.width ?? 0, rect?.height ?? 0);
  return loadCanvasBase(backgroundUrl, blankSize);
}

interface SetupContext {
  element: HTMLCanvasElement;
  container: HTMLElement | null;
  backgroundUrl: string | null;
  // 読み込みを待つ間に後始末されたか
  isDisposed: () => boolean;
  onFailed: () => void;
  onReady: (fc: fabric.Canvas, canvasSize: CanvasSize) => void;
}

// 下敷きを読み、まだ要るなら canvas を作って onReady へ渡す。
// 待つのは下敷きの読み込みの 1 回だけで、作ってから onReady までは同期で続く
// (間に後始末が挟まると、作った canvas を誰も捨てられなくなる)
async function setupDrawingCanvas(context: SetupContext): Promise<void> {
  const { image, canvasSize, failed } = await loadBaseFor(
    context.container,
    context.backgroundUrl,
  );
  if (failed) {
    context.onFailed();
  }
  if (context.isDisposed()) {
    return;
  }
  context.onReady(createDrawingCanvas(context.element, canvasSize, image), canvasSize);
}

// 図形道具を外し、canvas を捨てる (初期化の effect の後始末)
function disposeDrawingCanvas(
  fcRef: RefObject<fabric.Canvas | null>,
  shapeToolRef: RefObject<ShapeToolHandle | null>,
) {
  shapeToolRef.current?.detach();
  shapeToolRef.current = null;
  const fc = fcRef.current;
  fcRef.current = null;
  void fc?.dispose();
}

// --- 初期化 (背景の有無ごとに 1 度) -------------------------------------
export function useDrawCanvasLifecycle(params: LifecycleParams): void {
  const { backgroundUrl, canvasElRef, containerRef, fcRef, shapeToolRef } = params;
  const { setSize, setIsPreparing, setError } = params.status;

  // 初期化の effect が束ねるハンドラ・後始末から呼ぶ口。Effect Event なので
  // 依存に並ばず、呼んだ時点の関数へ届く — 初期化は背景が変わったときだけ走る
  const recordChange = useEffectEvent(() => params.scheduleSnapshot());
  const suspendRecording = useEffectEvent(() => params.suspendSnapshots());
  const resumeRecording = useEffectEvent((commit: boolean) => params.resumeSnapshots(commit));
  // 作った canvas に道具を取り付けて、準備を終える。控え (ref) は変わらない
  // ので、ここで読んでも初期化の effect で読んでも同じものが届く
  const completeSetup = useEffectEvent((fc: fabric.Canvas, canvasSize: CanvasSize) => {
    fcRef.current = fc;
    shapeToolRef.current = wireDrawingCanvas(
      fc,
      wiringFrom(fc, params, {
        recordChange: () => recordChange(),
        suspendRecording: () => suspendRecording(),
        resumeRecording: (commit) => resumeRecording(commit),
        onError: (message) => setError(message),
      }),
    );
    fc.requestRenderAll();
    setSize(canvasSize);
    params.resetHistory();
    params.refreshStats();
    setIsPreparing(false);
  });
  const teardown = useEffectEvent(() => {
    params.cancelScheduledSnapshot();
    params.releaseEraser();
  });

  useEffect(() => {
    const element = canvasElRef.current;
    if (!element) {
      return;
    }
    let disposed = false;
    setIsPreparing(true);
    setError(null);
    void setupDrawingCanvas({
      element,
      container: containerRef.current,
      backgroundUrl,
      isDisposed: () => disposed,
      onFailed: () => setError("背景にする画像を読み込めませんでした。白紙で描けます。"),
      onReady: (fc, canvasSize) => completeSetup(fc, canvasSize),
    });
    return () => {
      disposed = true;
      teardown();
      disposeDrawingCanvas(fcRef, shapeToolRef);
    };
  }, [backgroundUrl, canvasElRef, containerRef, fcRef, setError, setIsPreparing, shapeToolRef]);
}
