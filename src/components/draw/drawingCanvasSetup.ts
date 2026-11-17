"use client";

// fabric の canvas を作るまでの下ごしらえ (docs/34-お絵かき計画.md §3)。
// useDrawCanvas の初期化から切り出した (docs/128 §8-1)。下敷きを読んで器の
// 寸法を決め、canvas を作って下敷きを当てる。

import * as fabric from "fabric";
import { CANVAS_BACKGROUND } from "@/lib/draw/drawCanvasConst";
import { canvasSizeForImage, type CanvasSize } from "@/lib/draw/drawingFile";

export interface CanvasBase {
  image: fabric.FabricImage | null;
  canvasSize: CanvasSize;
  // 下敷きを読めなかった (白紙の器に落とした)
  failed: boolean;
}

// 下敷きを読み、器の寸法を決める。下敷きが無い・読めないときは白紙の器
export async function loadCanvasBase(
  backgroundUrl: string | null,
  blankSize: CanvasSize,
): Promise<CanvasBase> {
  if (!backgroundUrl) {
    return { image: null, canvasSize: blankSize, failed: false };
  }
  try {
    // 自前の画像 (同一オリジン) なので canvas は汚れず、書き出しもできる
    const image = await fabric.FabricImage.fromURL(backgroundUrl, {
      crossOrigin: "anonymous",
    });
    return {
      image,
      canvasSize: canvasSizeForImage(image.width, image.height),
      failed: false,
    };
  } catch {
    // 呼び手が「白紙で描けます」と知らせる
    return { image: null, canvasSize: blankSize, failed: true };
  }
}

// fabric の canvas を作り、器の寸法と下敷きを当てる
export function createDrawingCanvas(
  element: HTMLCanvasElement,
  canvasSize: CanvasSize,
  image: fabric.FabricImage | null,
): fabric.Canvas {
  const fc = new fabric.Canvas(element, {
    selection: false,
    preserveObjectStacking: true,
    backgroundColor: CANVAS_BACKGROUND,
    // **消しゴムの速さはこれで決まる** (docs/34-お絵かき計画.md §3-2)。
    // 既定の true は実バッファを論理サイズ × devicePixelRatio にする。
    // ここでは論理サイズを解像度として大きく取り、表示は CSS で縮めている
    // ので、その上に DPR を掛けても画面には 1px も現れない —— 3 倍の端末
    // なら 9 倍の画素を捨てるために描いていることになる。
    // 消しゴムは 1 フレームに canvas 全体を 3 回描くため、この無駄が
    // そのまま体感の重さになる
    enableRetinaScaling: false,
  });
  fc.setDimensions(canvasSize);

  if (image) {
    image.set({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      scaleX: canvasSize.width / image.width,
      scaleY: canvasSize.height / image.height,
      selectable: false,
      evented: false,
      // 消しゴムで写真そのものを消させない (@erase2d は erasable な
      // 背景だけを消す)。消えるのは自分で描いた線だけにする
      erasable: false,
    });
    fc.backgroundImage = image;
  }
  return fc;
}
