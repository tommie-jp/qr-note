"use client";

// お絵かきの canvas への操作口 (打ち切り・全消し・書き出し)。
// useDrawCanvas から切り出した (docs/128 §8-1)。どれも ref だけを読むので
// 作り直されない。

import type * as fabric from "fabric";
import { type RefObject, useCallback } from "react";
import { encodeDrawing } from "@/lib/draw/canvasUnits";
import { abortActiveStroke } from "./abortActiveStroke";
import type { ShapeToolHandle } from "./shapeTool";

export interface DrawCanvasActions {
  cancelActiveInput: () => void;
  clear: () => void;
  exportImage: () => Promise<{ blob: Blob; extension: string }>;
}

export function useDrawCanvasActions(
  fcRef: RefObject<fabric.Canvas | null>,
  shapeToolRef: RefObject<ShapeToolHandle | null>,
  suppressTapRef: RefObject<boolean>,
): DrawCanvasActions {
  // 2 本指ジェスチャの開始で、進行中の入力をすべて打ち切る (docs/36 §4-5)
  const cancelActiveInput = useCallback(() => {
    suppressTapRef.current = true; // 指を離したときの文字・塗りの発火を見送る
    shapeToolRef.current?.cancel(); // 図形のドラッグは仮表示ごと捨てる
    const fc = fcRef.current;
    if (!fc) {
      return;
    }
    abortActiveStroke(fc);
  }, [fcRef, shapeToolRef, suppressTapRef]);

  const clear = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) {
      return;
    }
    const objects = [...fc.getObjects()];
    if (objects.length === 0) {
      return;
    }
    fc.remove(...objects); // object:removed が履歴を積む (= 全消しも戻せる)
    fc.requestRenderAll();
  }, [fcRef]);

  const exportImage = useCallback(async () => {
    const fc = fcRef.current;
    if (!fc) {
      throw new Error("お絵かきの準備ができていません。");
    }
    // 選択枠や編集中のカーソルを写さない
    fc.discardActiveObject();
    fc.renderAll();
    // WebP を第一候補にし、書き出せなければ PNG へ落とす (encodeDrawing)
    return encodeDrawing(fc.toCanvasElement());
  }, [fcRef]);

  return { cancelActiveInput, clear, exportImage };
}
