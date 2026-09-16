"use client";

// ドラッグで図形を置く道具 (docs/36-お絵かき拡張計画.md §1)。
// 矢印・矩形・楕円が対象で、始点→終点のドラッグで形を決める。
//
// ドラッグ中は仮の図形を出しては消して描き直す。この間に履歴を積むと
// 途中の形が 1 手として残ってしまうので、呼び手に止めてもらう
// (beginPreview / endPreview)。
//
// 図形そのものの生成 (道具ごとの座標・線・鏃) は src/lib/draw/shapeFactory.ts。
// ここは canvas へのイベントの取り付けとドラッグの進行だけを持つ (docs/96 §3-2)。

import type * as fabric from "fabric";
import { createShape } from "@/lib/draw/shapeFactory";
import {
  type DragRect,
  dragDistance,
  type DrawPoint,
  normalizeDragRect,
} from "@/lib/draw/shapes";
import type { DrawTool } from "./drawTools";

export interface ShapeToolDeps {
  getTool: () => DrawTool;
  getColor: () => string;
  // canvas の論理 px に直した後の太さ
  getStrokeWidth: () => number;
  // タップと区別する最小の移動量 (canvas の論理 px)
  getMinDrag: () => number;
  // ドラッグ中は履歴を止める。commit が false なら何も置かずに終わった
  beginPreview: () => void;
  endPreview: (commit: boolean) => void;
  // 範囲だけを決める道具 (モザイク) の確定。図形は置かず、囲んだ矩形を渡す。
  // 実際に置くものは呼び手が後から作る (画素を読む処理が非同期なため)
  onRegion: (rect: DragRect) => void;
}

export interface ShapeToolHandle {
  // 進行中のドラッグを何も置かずに打ち切る (2 本指ジェスチャの開始時に呼ぶ)
  cancel: () => void;
  detach: () => void;
}

// fabric の canvas にドラッグ描画を取り付ける
export function attachShapeTool(fc: fabric.Canvas, deps: ShapeToolDeps): ShapeToolHandle {
  let start: DrawPoint | null = null;
  let last: DrawPoint | null = null;
  let preview: fabric.FabricObject | null = null;

  const clearPreview = () => {
    if (preview) {
      fc.remove(preview);
      preview = null;
    }
  };

  const onDown = (options: { e: TypedEvent }) => {
    if (!isShapeTool(deps.getTool())) {
      return;
    }
    start = fc.getScenePoint(options.e);
    last = start;
    preview = null;
    deps.beginPreview();
  };

  const onMove = (options: { e: TypedEvent }) => {
    if (!start) {
      return;
    }
    last = fc.getScenePoint(options.e);
    // 形が変わるたびに作り直す。Path の path データを差し替えるより素直で、
    // ドラッグ中は履歴を止めているので add/remove が残ることもない
    clearPreview();
    const next = createShape(
      deps.getTool(),
      start,
      last,
      deps.getColor(),
      deps.getStrokeWidth(),
    );
    if (next) {
      preview = next;
      fc.add(next);
    }
    fc.requestRenderAll();
  };

  const onUp = () => {
    if (!start) {
      return;
    }
    // 動いていなければタップ。仮の図形は残さない
    const moved = last !== null && dragDistance(start, last) >= deps.getMinDrag();
    const region = moved && last ? normalizeDragRect(start, last) : null;
    const isRegionTool = deps.getTool() === "mosaic";
    if (!moved || isRegionTool) {
      // 範囲を決めるだけの道具は、仮表示を必ず捨てる
      clearPreview();
    }
    const committed = !isRegionTool && moved && preview !== null;
    start = null;
    last = null;
    preview = null;
    fc.requestRenderAll();
    // 履歴を戻してから範囲を渡す。加工した画像が後から add されたときに、
    // その object:added が 1 手として積まれるようにする
    deps.endPreview(committed);
    if (isRegionTool && region) {
      deps.onRegion(region);
    }
  };

  fc.on("mouse:down", onDown);
  fc.on("mouse:move", onMove);
  fc.on("mouse:up", onUp);

  const cancel = () => {
    if (!start) {
      return;
    }
    clearPreview();
    start = null;
    last = null;
    preview = null;
    fc.requestRenderAll();
    deps.endPreview(false);
  };

  return {
    cancel,
    detach: () => {
      fc.off("mouse:down", onDown);
      fc.off("mouse:move", onMove);
      fc.off("mouse:up", onUp);
    },
  };
}

// fabric のポインタイベントは実際には Mouse/Touch/Pointer のいずれか。
// getScenePoint に渡せれば十分なのでここでは幅を持たせる
type TypedEvent = Parameters<fabric.Canvas["getScenePoint"]>[0];

export function isShapeTool(tool: DrawTool): boolean {
  return (
    tool === "arrow" || tool === "rect" || tool === "ellipse" || tool === "mosaic"
  );
}
