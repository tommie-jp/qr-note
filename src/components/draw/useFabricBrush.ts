"use client";

// 道具に合わせて fabric の描画モードとブラシを持ち替える (docs/34-お絵かき計画.md §3-2、
// docs/36-お絵かき拡張計画.md §2)。
//
// ブラシを作り直すのは**道具が変わったときだけ**。色・太さ・表示倍率の変更は
// applyBrushStyle で既存のブラシの width / color を書き換えるだけにする。

import { EraserBrush } from "@erase2d/fabric";
import * as fabric from "fabric";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { toCanvasUnits } from "@/lib/draw/canvasUnits";
import { markerColor } from "@/lib/draw/drawColor";
import {
  ERASER_SCALE,
  MARKER_SCALE,
  MIN_ERASER_WIDTH,
} from "@/lib/draw/drawCanvasConst";
import type { DrawTool } from "./drawTools";

interface UseFabricBrushParams {
  fcRef: RefObject<fabric.Canvas | null>;
  tool: DrawTool;
  // 準備が済むまで canvas が無いので、持ち替えは準備の完了を待つ
  isPreparing: boolean;
  // 色・太さの effect からも当て直すので、いまの値は控えから読む
  toolRef: Readonly<RefObject<DrawTool>>;
  colorRef: Readonly<RefObject<string>>;
  widthRef: Readonly<RefObject<number>>;
  fitScaleRef: Readonly<RefObject<number>>;
  // 選択可否・消しゴムの効き先はレイヤ状態と道具から導く (docs/50 §3-2)
  applyLayerState: () => void;
  // 消しゴムのストロークが終わったとき (履歴を積む)
  onEraseEnd: () => void;
}

export interface FabricBrush {
  applyBrushStyle: () => void;
  releaseEraser: () => void;
}

interface BrushStyle {
  tool: DrawTool;
  color: string;
  width: number;
  fitScale: number;
}

// ブラシに道具ごとの太さと色を当てる。太さは内容の大きさなので fitScale で割る
// (拡大しても論理サイズは変えない)
function styleBrush(brush: fabric.BaseBrush, { tool, color, width, fitScale }: BrushStyle) {
  if (tool === "eraser") {
    // 消しゴムに色は無い (下を消すだけ)
    brush.width = toCanvasUnits(Math.max(MIN_ERASER_WIDTH, width * ERASER_SCALE), fitScale);
    return;
  }
  if (tool === "marker") {
    brush.width = toCanvasUnits(width * MARKER_SCALE, fitScale);
    brush.color = markerColor(color);
    return;
  }
  brush.width = toCanvasUnits(width, fitScale);
  brush.color = color;
}

export function useFabricBrush({
  fcRef,
  tool,
  isPreparing,
  toolRef,
  colorRef,
  widthRef,
  fitScaleRef,
  applyLayerState,
  onEraseEnd,
}: UseFabricBrushParams): FabricBrush {
  const eraserDisposerRef = useRef<(() => void) | null>(null);
  const eraserRef = useRef<EraserBrush | null>(null);

  // 消しゴムを手放す。@erase2d の dispose は効果用の裏 canvas を 0×0 にして
  // GC に返すためのもので、呼ばないと捨てたブラシのぶんだけメモリが残る
  const releaseEraser = useCallback(() => {
    eraserDisposerRef.current?.();
    eraserDisposerRef.current = null;
    eraserRef.current?.dispose();
    eraserRef.current = null;
  }, []);

  // いまのブラシに色と太さを当てる。**ブラシは作り直さない** ——
  // EraserBrush は生成時に canvas 1 枚ぶんのメモリを確保するので、
  // 太さを変えるたびに作り直すと確保と破棄を繰り返すことになる
  const applyBrushStyle = useCallback(() => {
    const brush = fcRef.current?.freeDrawingBrush;
    if (!brush) {
      return;
    }
    styleBrush(brush, {
      tool: toolRef.current,
      color: colorRef.current,
      width: widthRef.current,
      fitScale: fitScaleRef.current,
    });
  }, [colorRef, fcRef, fitScaleRef, toolRef, widthRef]);

  // --- 道具の切り替え -----------------------------------------------------
  // ブラシを作り直すのは**道具が変わったときだけ**。色・太さの変更で作り直すと
  // 消しゴムのメモリ確保を繰り返すことになる (applyBrushStyle 参照)
  useEffect(() => {
    const fc = fcRef.current;
    if (!fc || isPreparing) {
      return;
    }
    fc.isDrawingMode = tool === "pen" || tool === "marker" || tool === "eraser";
    fc.selection = tool === "select";
    // 選択可否・消しゴムの効き先はレイヤ状態と道具から導く (docs/50 §3-2)。
    // 選択枠スタイルの当て直しと discardActiveObject もここに含まれる
    applyLayerState();

    if (tool === "pen" || tool === "marker") {
      // マーカーは色に alpha を載せた PencilBrush。**alpha < 1 のブラシは
      // needsFullRender() が真になり、消しゴムと同じ毎フレーム全再描画の
      // 経路に入る** (docs/36 §2)。docs/34 §3-2 の対策が効いている前提
      fc.freeDrawingBrush = new fabric.PencilBrush(fc);
    } else if (tool === "eraser") {
      const brush = new EraserBrush(fc);
      eraserRef.current = brush;
      fc.freeDrawingBrush = brush;
      // 消しゴムは object:* イベントを出さない (既存オブジェクトの clipPath を
      // 足すだけ) ので、専用の終了イベントから履歴を積む
      eraserDisposerRef.current = brush.on("end", () => onEraseEnd());
    } else {
      // 描かない道具のときはブラシを持たない (消しゴムの裏 canvas を抱えたままに
      // しない)
      fc.freeDrawingBrush = undefined;
    }
    applyBrushStyle();
    fc.requestRenderAll();

    return releaseEraser;
  }, [tool, isPreparing, fcRef, onEraseEnd, applyBrushStyle, applyLayerState, releaseEraser]);

  return { applyBrushStyle, releaseEraser };
}
