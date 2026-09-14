"use client";

// 押した所に文字を置く道具 (docs/34-お絵かき計画.md §2)。
// attachShapeTool と同じく、fabric の canvas にイベントを取り付ける形にする。
//
// **発火は mouse:up** (docs/36-お絵かき拡張計画.md §4-5)。down で発火すると、
// 2 本指ジェスチャの 1 本目の指でも発火してしまい、ピンチのつもりが文字を
// 置くことになる。up まで待ち、その間に 2 本目が着いていたら見送る。

import * as fabric from "fabric";
import { FONT_FAMILY } from "@/lib/draw/drawCanvasConst";
import type { DrawTool } from "./drawTools";

export interface TextToolDeps {
  getTool: () => DrawTool;
  getColor: () => string;
  // canvas の論理 px に直した後の文字の大きさ
  getFontSize: () => number;
  // 2 本指ジェスチャが始まっていたら真 (指を離しても置かない)
  isTapSuppressed: () => boolean;
}

// fabric の canvas に文字道具を取り付ける。外すのは canvas の dispose に任せる
export function attachTextTool(fc: fabric.Canvas, deps: TextToolDeps): void {
  // 何も無い所を押して離したら、その場に文字を置いて編集に入る
  fc.on("mouse:up", (options) => {
    if (deps.getTool() !== "text" || options.target || deps.isTapSuppressed()) {
      return;
    }
    const point = fc.getScenePoint(options.e);
    const text = new fabric.IText("", {
      left: point.x,
      top: point.y,
      // v7 の既定 origin は center (shapeTool の SHAPE_DEFAULTS 参照)。
      // 押した所から右下へ書き始める、従来の文字の置かれ方にする
      originX: "left",
      originY: "top",
      fill: deps.getColor(),
      fontFamily: FONT_FAMILY,
      fontSize: deps.getFontSize(),
      erasable: true,
    });
    fc.add(text);
    fc.setActiveObject(text);
    text.enterEditing();
    text.hiddenTextarea?.focus();
  });

  // 空のまま編集を抜けたら消す (見えないゴミを残さない)
  fc.on("text:editing:exited", (event) => {
    const text = event.target;
    if (text && !String(text.text ?? "").trim()) {
      fc.remove(text);
    }
  });
}
