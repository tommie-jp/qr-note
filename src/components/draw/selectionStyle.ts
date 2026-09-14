"use client";

// 選択枠を「白い紙の上でも見える」見た目にする (docs/34-お絵かき計画.md §3)。
// 色は固定だが、太さと角の大きさは表示倍率で変わるので、倍率が動くたびに
// 当て直す (useDrawCanvas の色・太さ・表示倍率の effect)。

import type * as fabric from "fabric";
import { toCanvasUnits } from "@/lib/draw/canvasUnits";
import {
  SELECTION_BORDER_PX,
  SELECTION_COLOR,
  SELECTION_CORNER_PX,
  SELECTION_TOUCH_CORNER_PX,
} from "@/lib/draw/drawCanvasConst";

// 複数選択 (ActiveSelection) は fabric が内部で作るオブジェクトなので、
// selection:created でも同じものを当てる (呼び手は applySelectionStyle 経由)
function styleForSelection(object: fabric.FabricObject, displayScale: number) {
  object.set({
    borderColor: SELECTION_COLOR,
    cornerColor: "#ffffff",
    cornerStrokeColor: SELECTION_COLOR,
    transparentCorners: false,
    borderScaleFactor: toCanvasUnits(SELECTION_BORDER_PX, displayScale),
    cornerSize: toCanvasUnits(SELECTION_CORNER_PX, displayScale),
    touchCornerSize: toCanvasUnits(SELECTION_TOUCH_CORNER_PX, displayScale),
  });
}

// displayScale は **いま画面に映っている縮み** (fitScale × zoom)。
// 拡大しながら選択しても、枠の太さが画面上で一定になるようにする
export function applySelectionStyle(fc: fabric.Canvas, displayScale: number) {
  fc.forEachObject((object) => styleForSelection(object, displayScale));
  const active = fc.getActiveObject();
  if (active) {
    styleForSelection(active, displayScale);
  }
  // 複数選択のドラッグ枠 (ラバーバンド) も同じ縮みを受けるので合わせて太らせる
  fc.selectionColor = "rgba(37, 99, 235, 0.1)";
  fc.selectionBorderColor = SELECTION_COLOR;
  fc.selectionLineWidth = toCanvasUnits(1.5, displayScale);
  fc.requestRenderAll();
}
