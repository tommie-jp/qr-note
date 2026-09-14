"use client";

// fabric の canvas 一式の面倒を見るフック (docs/34-お絵かき計画.md §3)。
// 道具の切り替え・取り消し履歴・背景画像・書き出しをここに閉じ込め、
// 見た目 (DrawModal / DrawToolbar) からは fabric を見えなくする。
//
// 中身は役割ごとのフックと道具に分けてある: 履歴 (useDrawHistory)・
// ブラシ (useFabricBrush)・レイヤ (useDrawLayers)・文字 (textTool)・
// 図形とモザイク (shapeTool)・塗りつぶし (rasterTool)・選択枠 (selectionStyle)。
// ここに残るのは canvas の作成と後始末、それらの結線、2 本指での打ち切り。

import "@erase2d/fabric"; // 副作用: ClippingGroup を classRegistry へ登録する
import { EraserBrush } from "@erase2d/fabric";
import * as fabric from "fabric";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  encodeDrawing,
  fitDisplayScale,
  toCanvasUnits,
} from "@/lib/draw/canvasUnits";
import {
  CANVAS_BACKGROUND,
  FONT_SCALE,
  MIN_FONT_SIZE,
  MIN_SHAPE_DRAG,
} from "@/lib/draw/drawCanvasConst";
import {
  blankCanvasSize,
  canvasSizeForImage,
  type CanvasSize,
} from "@/lib/draw/drawingFile";
import type { LayerId, LayerState } from "@/lib/draw/layers";
import { useLatest } from "@/components/hooks/useLatest";
import type { DrawTool } from "./drawTools";
import { buildFill, buildMosaic } from "./rasterTool";
import { applySelectionStyle } from "./selectionStyle";
import { attachShapeTool, type ShapeToolHandle } from "./shapeTool";
import { attachTextTool } from "./textTool";
import { useDrawHistory } from "./useDrawHistory";
import { attachLayerBanding, useDrawLayers } from "./useDrawLayers";
import { useFabricBrush } from "./useFabricBrush";

export type { DrawTool };

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

interface CanvasBase {
  image: fabric.FabricImage | null;
  canvasSize: CanvasSize;
  // 下敷きを読めなかった (白紙の器に落とした)
  failed: boolean;
}

// 下敷きを読み、器の寸法を決める。下敷きが無い・読めないときは白紙の器
async function loadCanvasBase(
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
function createDrawingCanvas(
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

export function useDrawCanvas({
  tool,
  color,
  width,
  backgroundUrl,
  availableWidth,
  availableHeight,
  zoom,
  layerState,
  canvasElRef,
  containerRef,
}: UseDrawCanvasParams): DrawCanvasApi {
  const fcRef = useRef<fabric.Canvas | null>(null);
  const shapeToolRef = useRef<ShapeToolHandle | null>(null);
  // 2 本指ジェスチャが始まったら、その down から始まるタップ発火を見送る
  const suppressTapRef = useRef(false);

  const [size, setSize] = useState<CanvasSize | null>(null);

  // 論理サイズを表示領域に収める倍率 (fitDisplayScale)
  const fitScale = fitDisplayScale(size, availableWidth, availableHeight);
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
  const [isPreparing, setIsPreparing] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const { isEmpty, layerCounts, refreshStats, applyLayerState } = useDrawLayers({
    fcRef,
    layerStateRef,
    toolRef,
    displayScaleRef,
  });
  const {
    canUndo,
    canRedo,
    undo,
    redo,
    scheduleSnapshot,
    resetHistory,
    suspendSnapshots,
    resumeSnapshots,
    cancelScheduledSnapshot,
  } = useDrawHistory({ fcRef, applyLayerState, refreshStats });
  const { applyBrushStyle, releaseEraser } = useFabricBrush({
    fcRef,
    tool,
    isPreparing,
    toolRef,
    colorRef,
    widthRef,
    fitScaleRef,
    applyLayerState,
    onEraseEnd: scheduleSnapshot,
  });

  // 初期化の effect が束ねるハンドラ・後始末から呼ぶ口。Effect Event なので
  // 依存に並ばず、呼んだ時点の関数へ届く — 初期化は背景が変わったときだけ走る
  const recordChange = useEffectEvent(() => scheduleSnapshot());
  const suspendRecording = useEffectEvent(() => suspendSnapshots());
  const resumeRecording = useEffectEvent((commit: boolean) => resumeSnapshots(commit));
  const finishSetup = useEffectEvent(() => {
    resetHistory();
    refreshStats();
  });
  const teardown = useEffectEvent(() => {
    cancelScheduledSnapshot();
    releaseEraser();
  });

  // --- 初期化 (背景の有無ごとに 1 度) -------------------------------------
  useEffect(() => {
    const element = canvasElRef.current;
    if (!element) {
      return;
    }
    let disposed = false;
    setIsPreparing(true);
    setError(null);

    const setup = async () => {
      // 白紙の器は開いた時点の枠だけで決める。描いている最中に画面を回して
      // 器を作り直すと、それまでの線の位置がずれるため、測るのは 1 度きり
      const rect = containerRef.current?.getBoundingClientRect();
      const blankSize = blankCanvasSize(rect?.width ?? 0, rect?.height ?? 0);
      const { image, canvasSize, failed } = await loadCanvasBase(backgroundUrl, blankSize);
      if (failed) {
        setError("背景にする画像を読み込めませんでした。白紙で描けます。");
      }
      if (disposed) {
        return;
      }

      const fc = createDrawingCanvas(element, canvasSize, image);
      fcRef.current = fc;

      // 新しく描いたものにアクティブレイヤを刻み、その帯の末尾へ挿し込む
      attachLayerBanding(fc, () => layerStateRef.current.active);
      for (const name of [
        "object:added",
        "object:removed",
        "object:modified",
        "text:changed",
      ] as const) {
        fc.on(name, () => recordChange());
      }

      // タップで即発火する道具 (文字・塗りつぶし) は **mouse:up** で発火する。
      // down で発火すると、2 本指ジェスチャの 1 本目の指でも発火してしまい、
      // ピンチのつもりが文字や塗りを置くことになる。up まで待ち、その間に
      // 2 本目が着いたら見送る (suppressTapRef)
      fc.on("mouse:down", () => {
        suppressTapRef.current = false;
      });

      // 文字道具: 何も無い所を押して離したら、その場に文字を置いて編集に入る
      attachTextTool(fc, {
        getTool: () => toolRef.current,
        getColor: () => colorRef.current,
        // 文字も内容なので fitScale 基準。拡大中に置いても、100% に
        // 戻したとき他の文字と同じ大きさになる
        getFontSize: () =>
          toCanvasUnits(
            Math.max(MIN_FONT_SIZE, widthRef.current * FONT_SCALE),
            fitScaleRef.current,
          ),
        isTapSuppressed: () => suppressTapRef.current,
      });
      // 複数選択は fabric が ActiveSelection を内部で作るので、
      // 出来たその場で選択枠のスタイルを当てる
      fc.on("selection:created", () => {
        applySelectionStyle(fc, displayScaleRef.current);
      });

      // 画素を加工した結果 (塗りつぶし・モザイク) を 1 枚のオブジェクトとして
      // 足す。履歴も消しゴムも object:added の既存経路に乗る。作っている間に
      // canvas が作り直されていたら捨てる
      const addRaster = (
        build: Promise<fabric.FabricImage | null>,
        failure: string,
      ) => {
        void build
          .then((object) => {
            if (object && fcRef.current === fc) {
              fc.add(object);
              fc.requestRenderAll();
            }
          })
          .catch(() => {
            setError(failure);
          });
      };

      // 塗りつぶし: クリックした点と繋がった範囲を塗る (docs/35)
      fc.on("mouse:up", (options) => {
        if (toolRef.current !== "fill" || suppressTapRef.current) {
          return;
        }
        const point = fc.getScenePoint(options.e);
        addRaster(buildFill(fc, point, colorRef.current), "塗りつぶせませんでした。");
      });

      // 矢印・矩形・楕円のドラッグ描画 (docs/36 §1)。
      // ドラッグ中は仮の図形を出し入れするので履歴を止め、離したときに 1 手積む
      shapeToolRef.current = attachShapeTool(fc, {
        getTool: () => toolRef.current,
        getColor: () => colorRef.current,
        // 図形の線は内容 → fitScale。タップ判定は指の動き → displayScale
        getStrokeWidth: () => toCanvasUnits(widthRef.current, fitScaleRef.current),
        getMinDrag: () => toCanvasUnits(MIN_SHAPE_DRAG, displayScaleRef.current),
        beginPreview: () => suspendRecording(),
        endPreview: (commit) => resumeRecording(commit),
        // モザイク: 囲んだ範囲の画素を升目の平均色に均して置き換える
        // (docs/36 §3)。塗りつぶしと同じラスタ経路
        onRegion: (region) => {
          addRaster(buildMosaic(fc, region), "モザイクを作れませんでした。");
        },
      });

      fc.requestRenderAll();
      setSize(canvasSize);
      finishSetup();
      setIsPreparing(false);
    };

    void setup();

    return () => {
      disposed = true;
      teardown();
      shapeToolRef.current?.detach();
      shapeToolRef.current = null;
      const fc = fcRef.current;
      fcRef.current = null;
      void fc?.dispose();
    };
  }, [
    backgroundUrl,
    canvasElRef,
    colorRef,
    containerRef,
    displayScaleRef,
    fitScaleRef,
    layerStateRef,
    toolRef,
    widthRef,
  ]);

  // --- 色・太さ・表示倍率の反映 --------------------------------------------
  useEffect(() => {
    applyBrushStyle();
    // 拡大しながら選択しても、枠の太さが画面上で一定になるように当て直す
    const fc = fcRef.current;
    if (fc) {
      applySelectionStyle(fc, displayScale);
    }
  }, [color, width, displayScale, applyBrushStyle]);

  // --- レイヤ状態の反映 (docs/50 §3-2 の当て直し 1 箇所目) -------------------
  // アクティブの切り替え・表示/非表示で、見え方と消しゴム・選択の効き先を
  // 全オブジェクトへ落とし込む。layerStateRef は上の useLatest が先に更新する
  useEffect(() => {
    if (isPreparing) {
      return;
    }
    applyLayerState();
  }, [layerState, isPreparing, applyLayerState]);

  // 2 本指ジェスチャの開始で、進行中の入力をすべて打ち切る (docs/36 §4-5)。
  // ペン・消しゴムのストローク中断に公開 API は無く、_isCurrentlyDrawing を
  // 折るのが唯一の手段。名前が変わっても描画自体は壊れないよう防御的に触る
  const cancelActiveInput = useCallback(() => {
    suppressTapRef.current = true; // 指を離したときの文字・塗りの発火を見送る
    shapeToolRef.current?.cancel(); // 図形のドラッグは仮表示ごと捨てる
    const fc = fcRef.current;
    if (!fc) {
      return;
    }
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
  }, []);

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
  }, []);

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
  }, []);

  return {
    size,
    displayScale,
    isPreparing,
    error,
    canUndo,
    canRedo,
    isEmpty,
    layerCounts,
    undo,
    redo,
    clear,
    exportImage,
    cancelActiveInput,
  };
}
