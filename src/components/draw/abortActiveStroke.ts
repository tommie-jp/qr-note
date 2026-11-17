"use client";

// 描きかけのペン・消しゴムのストロークを何も残さず打ち切る (docs/36 §4-5)。
// useDrawCanvas の cancelActiveInput から切り出した (docs/128 §8-1)。
//
// ペン・消しゴムのストローク中断に公開 API は無く、_isCurrentlyDrawing を
// 折るのが唯一の手段。名前が変わっても描画自体は壊れないよう防御的に触る

import { EraserBrush } from "@erase2d/fabric";
import * as fabric from "fabric";

export function abortActiveStroke(fc: fabric.Canvas): void {
  const internal = fc as unknown as { _isCurrentlyDrawing?: boolean };
  if (!internal._isCurrentlyDrawing) {
    return;
  }
  try {
    // これで canvas 側は以降の move を無視し、up でもブラシを確定しない
    internal._isCurrentlyDrawing = false;
    const brush = fc.freeDrawingBrush;
    if (brush instanceof EraserBrush) {
      // active を折ってから up を呼ぶと、確定 (super) を跳ばして
      // after:render リスナの後始末だけが走る (@erase2d の実装で確認)。
      // active は型上 private だが、実体は普通のプロパティ
      const eraser = brush as unknown as {
        active: boolean;
        onMouseUp: (context: { e: Event; pointer: fabric.Point }) => boolean;
      };
      eraser.active = false;
      eraser.onMouseUp({
        e: new MouseEvent("mouseup"),
        pointer: new fabric.Point(0, 0),
      });
    }
    // 描きかけの線は上段 canvas にしか無いので、拭えば消える
    fc.clearContext(fc.getTopContext());
    fc.requestRenderAll();
  } catch {
    // 打ち切れなくても、描き続けられることを優先して黙って進む
  }
}
