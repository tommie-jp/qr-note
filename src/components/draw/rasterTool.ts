"use client";

// 画素を読んで加工し、結果を 1 枚のオブジェクトとして置く道具
// (塗りつぶし: docs/35 §3 / モザイク: docs/36 §3-2)。
//
// 読み取り元は fabric の下段 canvas (lowerCanvasEl)。ここには背景色・下敷き
// 画像・全オブジェクトが合成済みで、選択枠などの UI は上段に分かれているので
// 写り込まない。enableRetinaScaling: false (docs/34 §3-2) のおかげで
// 実バッファ = 論理サイズになっており、座標の変換も追加のレンダも要らない。
//
// 加工結果は「その領域だけを持つ透過 PNG」を FabricImage として足すだけ。
// オブジェクトが増えるだけなので、取り消し履歴も消しゴムも既存の仕組みが
// そのまま効く (新規に履歴を触るコードは要らない)。
//
// 範囲の丸めと切り出し (clampToCanvas / cropImage) は canvas を触らない計算
// なので src/lib/draw/raster.ts に置き、単体テストで固定している (docs/96 §3-2)。

import * as fabric from "fabric";
import { hexToRgb } from "@/lib/draw/drawColor";
import {
  type FillBounds,
  floodFillMask,
  type RgbaImage,
} from "@/lib/draw/floodFill";
import { mosaicBlockSize, pixelate } from "@/lib/draw/pixelate";
import { clampToCanvas, cropImage } from "@/lib/draw/raster";
import type { DragRect, DrawPoint } from "@/lib/draw/shapes";

// ペンの線はアンチエイリアスされていて境界の画素が基準色と微妙に違う。
// 0 だと線の際が塗り残る
const FILL_TOLERANCE = 32;

// 求めた領域を 1px 膨らませる。許容差だけでは線との間に細い隙間 (ハロー) が
// 残りやすい
const FILL_DILATE = 1;

const RASTER_DEFAULTS = {
  originX: "left",
  originY: "top",
  selectable: false,
  evented: false,
  erasable: true,
} as const;

function readCanvas(fc: fabric.Canvas): RgbaImage | null {
  const element = fc.lowerCanvasEl;
  const context = element?.getContext("2d", { willReadFrequently: true });
  if (!element || !context) {
    return null;
  }
  // **必ず同期で描き直してから読む**。fabric の remove / add が呼ぶのは
  // requestRenderAll で、実際の描画は rAF まで待たされる。読むだけなら
  // 待てばよいが、モザイクは「範囲を見せていた黒い仮表示を消した直後」に
  // 読むため、待たずに読むと**仮表示が焼き込まれたままの画素**を拾い、
  // 平坦な黒い板が出来上がる (実測: 赤 255 の場所が 153 で読めた)
  fc.renderAll();
  const { data, width, height } = context.getImageData(
    0,
    0,
    element.width,
    element.height,
  );
  return { data, width, height };
}

// 加工した画素を切り出しの canvas に載せ、dataURL 経由で FabricImage にする。
// src が dataURL なので toObject() / loadFromJSON() の履歴復元がそのまま効く
async function toFabricImage(
  pixels: ImageData,
  bounds: FillBounds,
): Promise<fabric.FabricImage | null> {
  const patch = document.createElement("canvas");
  patch.width = bounds.width;
  patch.height = bounds.height;
  const context = patch.getContext("2d");
  if (!context) {
    return null;
  }
  context.putImageData(pixels, 0, 0);
  const image = await fabric.FabricImage.fromURL(patch.toDataURL("image/png"));
  image.set({ ...RASTER_DEFAULTS, left: bounds.left, top: bounds.top });
  // 一時 canvas は握り続けない (iOS のメモリ。docs/35 §7)
  patch.width = 0;
  patch.height = 0;
  return image;
}

// クリックした点と繋がった範囲を color で塗る。塗る所が無ければ null
export async function buildFill(
  fc: fabric.Canvas,
  point: DrawPoint,
  color: string,
): Promise<fabric.FabricImage | null> {
  const image = readCanvas(fc);
  if (!image) {
    return null;
  }
  const { mask, bounds } = floodFillMask(image, point, {
    tolerance: FILL_TOLERANCE,
    dilate: FILL_DILATE,
  });
  if (!bounds) {
    return null;
  }
  const [r, g, b] = hexToRgb(color);
  const pixels = new ImageData(bounds.width, bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      if (!mask[(y + bounds.top) * image.width + (x + bounds.left)]) {
        continue;
      }
      const at = (y * bounds.width + x) * 4;
      pixels.data[at] = r;
      pixels.data[at + 1] = g;
      pixels.data[at + 2] = b;
      pixels.data[at + 3] = 255;
    }
  }
  return toFabricImage(pixels, bounds);
}

// 囲んだ範囲をモザイクにする。塗りつぶしと同じ経路で、加工が平均色の
// 升目に変わるだけ (docs/36 §3-2)
export async function buildMosaic(
  fc: fabric.Canvas,
  rect: DragRect,
): Promise<fabric.FabricImage | null> {
  const image = readCanvas(fc);
  if (!image) {
    return null;
  }
  const bounds = clampToCanvas(rect, image);
  if (!bounds) {
    return null;
  }
  const region = cropImage(image, bounds);
  const blurred = pixelate(region, mosaicBlockSize(bounds.width, bounds.height));
  // 生の配列から ImageData を組むと、TypedArray の buffer の型が合わない
  // (SharedArrayBuffer を含みうるため)。空を作って書き写す
  const pixels = new ImageData(bounds.width, bounds.height);
  pixels.data.set(blurred.data);
  return toFabricImage(pixels, bounds);
}
