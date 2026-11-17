"use client";

// 作った fabric の canvas に道具と履歴のイベントを取り付ける (docs/34-お絵かき計画.md §3)。
// useDrawCanvas の初期化から切り出した (docs/128 §8-1)。取り付ける順は
// 元の初期化と同じ (レイヤの帯 → 履歴 → タップの見送り解除 → 文字 → 選択枠 →
// 塗りつぶし → 図形)。同じ mouse:up に複数が載るので、順を入れ替えない。
//
// 道具・色・太さ・倍率は 1 度だけ束ねたハンドラから読むので、値ではなく
// その時点の値を返す関数で受ける。

import type * as fabric from "fabric";
import { toCanvasUnits } from "@/lib/draw/canvasUnits";
import { FONT_SCALE, MIN_FONT_SIZE, MIN_SHAPE_DRAG } from "@/lib/draw/drawCanvasConst";
import type { LayerId } from "@/lib/draw/layers";
import type { DrawTool } from "./drawTools";
import { buildFill, buildMosaic } from "./rasterTool";
import { applySelectionStyle } from "./selectionStyle";
import { attachShapeTool, type ShapeToolHandle } from "./shapeTool";
import { attachTextTool } from "./textTool";
import { attachLayerBanding } from "./useDrawLayers";

export interface DrawingCanvasWiring {
  getTool: () => DrawTool;
  getColor: () => string;
  // 100% 表示のときの見た目 px
  getWidth: () => number;
  getFitScale: () => number;
  getDisplayScale: () => number;
  getActiveLayer: () => LayerId;
  // 2 本指ジェスチャが始まったら、その down から始まるタップ発火を見送る
  isTapSuppressed: () => boolean;
  clearTapSuppression: () => void;
  // この canvas がまだ使われているか (作り直されていたら偽)
  isCurrent: () => boolean;
  recordChange: () => void;
  suspendRecording: () => void;
  resumeRecording: (commit: boolean) => void;
  onError: (message: string) => void;
}

// 画素を加工した結果 (塗りつぶし・モザイク) を 1 枚のオブジェクトとして
// 足す。履歴も消しゴムも object:added の既存経路に乗る。作っている間に
// canvas が作り直されていたら捨てる
function addRaster(
  fc: fabric.Canvas,
  wiring: DrawingCanvasWiring,
  build: Promise<fabric.FabricImage | null>,
  failure: string,
) {
  void build
    .then((object) => {
      if (object && wiring.isCurrent()) {
        fc.add(object);
        fc.requestRenderAll();
      }
    })
    .catch(() => {
      wiring.onError(failure);
    });
}

// 履歴を積むきっかけ (追加・削除・変形・文字の書き換え)
function wireRecording(fc: fabric.Canvas, wiring: DrawingCanvasWiring) {
  for (const name of [
    "object:added",
    "object:removed",
    "object:modified",
    "text:changed",
  ] as const) {
    fc.on(name, () => wiring.recordChange());
  }
}

// タップで即発火する道具 (文字・塗りつぶし) は **mouse:up** で発火する。
// down で発火すると、2 本指ジェスチャの 1 本目の指でも発火してしまい、
// ピンチのつもりが文字や塗りを置くことになる。up まで待ち、その間に
// 2 本目が着いたら見送る (isTapSuppressed)
function wireTapTools(fc: fabric.Canvas, wiring: DrawingCanvasWiring) {
  fc.on("mouse:down", () => {
    wiring.clearTapSuppression();
  });

  // 文字道具: 何も無い所を押して離したら、その場に文字を置いて編集に入る
  attachTextTool(fc, {
    getTool: wiring.getTool,
    getColor: wiring.getColor,
    // 文字も内容なので fitScale 基準。拡大中に置いても、100% に
    // 戻したとき他の文字と同じ大きさになる
    getFontSize: () =>
      toCanvasUnits(Math.max(MIN_FONT_SIZE, wiring.getWidth() * FONT_SCALE), wiring.getFitScale()),
    isTapSuppressed: wiring.isTapSuppressed,
  });
  // 複数選択は fabric が ActiveSelection を内部で作るので、
  // 出来たその場で選択枠のスタイルを当てる
  fc.on("selection:created", () => {
    applySelectionStyle(fc, wiring.getDisplayScale());
  });

  // 塗りつぶし: クリックした点と繋がった範囲を塗る (docs/35)
  fc.on("mouse:up", (options) => {
    if (wiring.getTool() !== "fill" || wiring.isTapSuppressed()) {
      return;
    }
    const point = fc.getScenePoint(options.e);
    addRaster(fc, wiring, buildFill(fc, point, wiring.getColor()), "塗りつぶせませんでした。");
  });
}

// 矢印・矩形・楕円のドラッグ描画 (docs/36 §1)。
// ドラッグ中は仮の図形を出し入れするので履歴を止め、離したときに 1 手積む
function wireShapeTool(fc: fabric.Canvas, wiring: DrawingCanvasWiring): ShapeToolHandle {
  return attachShapeTool(fc, {
    getTool: wiring.getTool,
    getColor: wiring.getColor,
    // 図形の線は内容 → fitScale。タップ判定は指の動き → displayScale
    getStrokeWidth: () => toCanvasUnits(wiring.getWidth(), wiring.getFitScale()),
    getMinDrag: () => toCanvasUnits(MIN_SHAPE_DRAG, wiring.getDisplayScale()),
    beginPreview: () => wiring.suspendRecording(),
    endPreview: (commit) => wiring.resumeRecording(commit),
    // モザイク: 囲んだ範囲の画素を升目の平均色に均して置き換える
    // (docs/36 §3)。塗りつぶしと同じラスタ経路
    onRegion: (region) => {
      addRaster(fc, wiring, buildMosaic(fc, region), "モザイクを作れませんでした。");
    },
  });
}

// 取り付けて、図形道具の操作口 (打ち切り・取り外し) を返す
export function wireDrawingCanvas(
  fc: fabric.Canvas,
  wiring: DrawingCanvasWiring,
): ShapeToolHandle {
  // 新しく描いたものにアクティブレイヤを刻み、その帯の末尾へ挿し込む
  attachLayerBanding(fc, wiring.getActiveLayer);
  wireRecording(fc, wiring);
  wireTapTools(fc, wiring);
  return wireShapeTool(fc, wiring);
}
