"use client";

// fabric の canvas 一式の面倒を見るフック (docs/34-お絵かき計画.md §3)。
// 道具の切り替え・取り消し履歴・背景画像・書き出しをここに閉じ込め、
// 見た目 (DrawModal / DrawToolbar) からは fabric を見えなくする。
//
// 中身は役割ごとのフックと道具に分けてある: 履歴 (useDrawHistory)・
// ブラシ (useFabricBrush)・レイヤ (useDrawLayers)・文字 (textTool)・
// 図形とモザイク (shapeTool)・塗りつぶし (rasterTool)・選択枠 (selectionStyle)。
// canvas の作成と後始末は useDrawCanvasLifecycle (道具の取り付けは
// wireDrawingCanvas)、2 本指での打ち切り・全消し・書き出しは
// useDrawCanvasActions。ここに残るのはそれらの結線と表示倍率 (docs/128 §8-1)。

import "@erase2d/fabric"; // 副作用: ClippingGroup を classRegistry へ登録する
import type * as fabric from "fabric";
import { type RefObject, useEffect, useRef } from "react";
import { fitDisplayScale } from "@/lib/draw/canvasUnits";
import type { CanvasSize } from "@/lib/draw/drawingFile";
import type { LayerId, LayerState } from "@/lib/draw/layers";
import { useLatest } from "@/components/hooks/useLatest";
import type { DrawTool } from "./drawTools";
import { applySelectionStyle } from "./selectionStyle";
import type { ShapeToolHandle } from "./shapeTool";
import { useDrawCanvasActions } from "./useDrawCanvasActions";
import { useCanvasStatus, useDrawCanvasLifecycle } from "./useDrawCanvasLifecycle";
import { useDrawHistory } from "./useDrawHistory";
import { useDrawLayers } from "./useDrawLayers";
import { useFabricBrush } from "./useFabricBrush";


// 返り値に ref を混ぜない。ref を持つオブジェクトはレンダー中に読めない
// ものとして扱われるため (react-hooks/refs)、canvas と枠の ref は引数で受ける
export interface DrawCanvasApi {
  // canvas の論理サイズ (= 書き出す画像の解像度)。準備できるまで null
  size: CanvasSize | null;
  // canvas を画面に出すときの倍率。呼び手はこれで CSS の拡縮をかける
  displayScale: number;
  isPreparing: boolean;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  isEmpty: boolean;
  // レイヤごとのオブジェクト数 (パネルの「どこに何があるか」表示に使う)
  layerCounts: Readonly<Record<LayerId, number>>;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  exportImage: () => Promise<{ blob: Blob; extension: string }>;
  // 2 本指ジェスチャの開始時に呼ぶ。1 本目の指で始まってしまった描きかけの
  // 線・図形を何も残さず打ち切り、指を離したときのタップ発火も見送らせる
  cancelActiveInput: () => void;
}

interface UseDrawCanvasParams {
  tool: DrawTool;
  color: string;
  // 太さ・文字の大きさは **100% 表示のときの見た目 px** で受ける。ユーザーが
  // 選ぶのは見た目の太さなので、canvas の論理サイズが大きいほど太く描く。
  // 拡大 (zoom) はここに関与しない — 虫めがねであって、道具は変えない
  width: number;
  // 背景に敷く自前画像の URL (`/api/images/...`)。白紙なら null
  backgroundUrl: string | null;
  // canvas を出す領域の実測値。論理サイズとの比が表示倍率になる。
  // 測る前 (0) や画面の回転にも追従する
  availableWidth: number;
  availableHeight: number;
  // 「手」道具での拡大率 (1 = 全体が収まる大きさ)。docs/36 §4
  zoom: number;
  // セッション内レイヤの状態 (docs/50)。新しく描くものはアクティブレイヤに
  // 載り、消しゴム・選択はアクティブレイヤ限定、非表示レイヤは書き出さない
  layerState: LayerState;
  // fabric を載せる canvas 要素
  canvasElRef: React.RefObject<HTMLCanvasElement | null>;
  // 白紙のときの器の縦横比を決めるために測る、canvas を置く枠。
  // 初期化 (mount 後) に 1 度だけ読む
  containerRef: React.RefObject<HTMLElement | null>;
}

interface CanvasPartsParams {
  fcRef: RefObject<fabric.Canvas | null>;
  tool: DrawTool;
  isPreparing: boolean;
  toolRef: Readonly<RefObject<DrawTool>>;
  colorRef: Readonly<RefObject<string>>;
  widthRef: Readonly<RefObject<number>>;
  fitScaleRef: Readonly<RefObject<number>>;
  displayScaleRef: Readonly<RefObject<number>>;
  layerStateRef: Readonly<RefObject<LayerState>>;
}

// 役割ごとのフック (レイヤ → 履歴 → ブラシ) を、この順に結ぶ。
// ブラシの持ち替えの effect は初期化の effect より先に並ぶ (元の順のまま)
function useCanvasParts({
  fcRef,
  tool,
  isPreparing,
  toolRef,
  colorRef,
  widthRef,
  fitScaleRef,
  displayScaleRef,
  layerStateRef,
}: CanvasPartsParams) {
  const layers = useDrawLayers({ fcRef, layerStateRef, toolRef, displayScaleRef });
  const history = useDrawHistory({
    fcRef,
    applyLayerState: layers.applyLayerState,
    refreshStats: layers.refreshStats,
  });
  const brush = useFabricBrush({
    fcRef,
    tool,
    isPreparing,
    toolRef,
    colorRef,
    widthRef,
    fitScaleRef,
    applyLayerState: layers.applyLayerState,
    onEraseEnd: history.scheduleSnapshot,
  });
  return { ...layers, ...history, ...brush };
}

interface StyleSyncParams {
  fcRef: RefObject<fabric.Canvas | null>;
  color: string;
  width: number;
  displayScale: number;
  layerState: LayerState;
  isPreparing: boolean;
  applyBrushStyle: () => void;
  applyLayerState: () => void;
}

function useCanvasStyleSync({
  fcRef,
  color,
  width,
  displayScale,
  layerState,
  isPreparing,
  applyBrushStyle,
  applyLayerState,
}: StyleSyncParams) {
  // --- 色・太さ・表示倍率の反映 --------------------------------------------
  useEffect(() => {
    applyBrushStyle();
    // 拡大しながら選択しても、枠の太さが画面上で一定になるように当て直す
    const fc = fcRef.current;
    if (fc) {
      applySelectionStyle(fc, displayScale);
    }
  }, [color, width, displayScale, applyBrushStyle, fcRef]);

  // --- レイヤ状態の反映 (docs/50 §3-2 の当て直し 1 箇所目) -------------------
  // アクティブの切り替え・表示/非表示で、見え方と消しゴム・選択の効き先を
  // 全オブジェクトへ落とし込む。layerStateRef は useLatest が先に更新する
  useEffect(() => {
    if (isPreparing) {
      return;
    }
    applyLayerState();
  }, [layerState, isPreparing, applyLayerState]);
}

export function useDrawCanvas(params: UseDrawCanvasParams): DrawCanvasApi {
  const { tool, color, width, zoom, layerState } = params;
  const fcRef = useRef<fabric.Canvas | null>(null);
  const shapeToolRef = useRef<ShapeToolHandle | null>(null);
  // 2 本指ジェスチャが始まったら、その down から始まるタップ発火を見送る
  const suppressTapRef = useRef(false);
  const status = useCanvasStatus();

  // 論理サイズを表示領域に収める倍率 (fitDisplayScale)
  const fitScale = fitDisplayScale(status.size, params.availableWidth, params.availableHeight);
  // 倍率は 2 系統に分ける (docs/36 §4-2)。
  //
  // - fitScale: 100% 表示のときの縮み。**内容の大きさ** (ペン・文字・図形の
  //   論理サイズ) はこちらで決める — 拡大は虫めがねで、道具の論理サイズは
  //   倍率に依らず一定。拡大中に置いた文字が 100% に戻すと他より小さい、
  //   という食い違いを起こさない
  // - displayScale (= fitScale × zoom): いま画面に映っている縮み。
  //   **UI (選択ハンドル) と操作の判定** (タップとドラッグの区別) は
  //   画面上の見た目で決めたいのでこちらで割る
  const displayScale = fitScale * zoom;

  // 初期化のときに 1 度だけ束ねた fabric のイベントハンドラから、
  // そのときどきの道具・色・太さを読むための控え。下の useCallback や初期化の
  // effect の依存に並ぶが、ref 自体は変わらないので作り直し・張り直しは起きない
  const toolRef = useLatest(tool);
  const colorRef = useLatest(color);
  const widthRef = useLatest(width);
  const fitScaleRef = useLatest(fitScale);
  const displayScaleRef = useLatest(displayScale);
  // 描いている最中の object:added からいまのアクティブレイヤを読むための控え。
  // 初期化のイベントハンドラは 1 度しか束ねないので、state ではなく ref で持つ
  const layerStateRef = useLatest(layerState);
  const refs = { toolRef, colorRef, widthRef, fitScaleRef, displayScaleRef, layerStateRef };

  const parts = useCanvasParts({ fcRef, tool, isPreparing: status.isPreparing, ...refs });
  useDrawCanvasLifecycle({ ...params, ...parts, ...refs, fcRef, shapeToolRef, suppressTapRef, status });
  useCanvasStyleSync({ ...parts, fcRef, color, width, displayScale, layerState, isPreparing: status.isPreparing });
  const actions = useDrawCanvasActions(fcRef, shapeToolRef, suppressTapRef);

  return {
    size: status.size,
    displayScale,
    isPreparing: status.isPreparing,
    error: status.error,
    canUndo: parts.canUndo,
    canRedo: parts.canRedo,
    isEmpty: parts.isEmpty,
    layerCounts: parts.layerCounts,
    undo: parts.undo,
    redo: parts.redo,
    ...actions,
  };
}
