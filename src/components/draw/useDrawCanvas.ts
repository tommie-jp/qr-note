"use client";

// fabric の canvas 一式の面倒を見るフック (docs/34-お絵かき計画.md §3)。
// 道具の切り替え・取り消し履歴・背景画像・書き出しをここに閉じ込め、
// 見た目 (DrawModal / DrawToolbar) からは fabric を見えなくする。

import "@erase2d/fabric"; // 副作用: ClippingGroup を classRegistry へ登録する
import { EraserBrush } from "@erase2d/fabric";
import * as fabric from "fabric";
import { useCallback, useEffect, useRef, useState } from "react";
import { markerColor } from "@/lib/draw/drawColor";
import {
  blankCanvasSize,
  canvasSizeForImage,
  type CanvasSize,
} from "@/lib/draw/drawingFile";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  createHistory,
  currentEntry,
  type DrawHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "@/lib/draw/history";
import {
  insertionIndex,
  type LayerId,
  type LayerState,
  layerFlags,
} from "@/lib/draw/layers";
import { useLatest } from "@/components/hooks/useLatest";
import type { DrawTool } from "./drawTools";
import { buildFill, buildMosaic } from "./rasterTool";
import { attachShapeTool, type ShapeToolHandle } from "./shapeTool";

export type { DrawTool };

// 消しゴムはペンと同じ太さだと細すぎて狙って消せない
const ERASER_SCALE = 3;
const MIN_ERASER_WIDTH = 8;

// マーカーは蛍光ペンなので、ペンより太くないとそれらしく見えない
const MARKER_SCALE = 3;

// 描き終わりから履歴を積むまでの待ち。1 ストロークで複数のイベントが飛ぶので、
// まとめて 1 手にする
const SNAPSHOT_DEBOUNCE_MS = 150;

// 書き出しは WebP を第一候補にする。写真に注釈を入れると PNG では
// 10MB の投稿上限 (src/lib/uploads/limits.ts) に届きうるため
const WEBP_QUALITY = 0.92;

// 白紙の下地。透過のままだと、貼った先の背景次第で線が見えなくなる
const CANVAS_BACKGROUND = "#ffffff";

// 表示倍率の下限。測り終える前の 0 で割らないための保険
const MIN_DISPLAY_SCALE = 0.05;

// 小さい画像を下敷きにしたとき、原寸のままだと狙って描けない。
// ただし伸ばしすぎてもぼけるだけなので頭を打たせる
const MAX_DISPLAY_SCALE = 3;

// 文字の大きさ。太さから決める (太いペンを選んでいるなら大きい字が要る)
const FONT_SCALE = 4;
const MIN_FONT_SIZE = 18;

// 日本語を出すので、既定の Times New Roman には任せない
const FONT_FAMILY = "system-ui, sans-serif";

// 図形をドラッグで置くときの、タップと区別する最小の移動量 (画面で見た px)
const MIN_SHAPE_DRAG = 4;

// 選択枠の見た目 (画面で見た px)。fabric の既定は淡い青 (rgb(178,204,255))・
// 枠 1px・角は塗りなしで、白い紙の上ではほぼ見えない。さらに選択枠は
// canvas の論理 px で描かれて CSS で縮むので、太さ・角の大きさは
// toCanvasUnits で表示倍率ぶん膨らませてから渡す
const SELECTION_COLOR = "#2563eb"; // アプリの主色 (blue-600) に揃える
const SELECTION_BORDER_PX = 2;
// ハンドル (□) は指で狙う目印なので、マウス向けの定番 (10px 前後) より
// 大きく描く。小さいと狙いが甘くなり、当たり判定を広げても外れる
const SELECTION_CORNER_PX = 20;
// タッチの当たり判定は見た目よりさらに大きく取る。指は先端で 10px 以上
// ぶれるので、Apple HIG の最小タップ領域 (44pt) に合わせる。判定だけで、
// 描画は SELECTION_CORNER_PX のまま変わらない
const SELECTION_TOUCH_CORNER_PX = 44;

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

// 画面で見た px を canvas の論理 px に直す。1600px の写真を幅 400px で表示して
// いるなら 6px の線は 24 論理 px —— これをしないと、大きな画像に描いた線が
// 髪の毛のように細くなる。0 除算と、測る前の 0 を避けて下限を敷く
function toCanvasUnits(screenPixels: number, displayScale: number): number {
  return screenPixels / Math.max(displayScale, MIN_DISPLAY_SCALE);
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
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
  // シーンを流し込んでいる間は履歴を積まない (戻した結果をまた積むと戻れなくなる)
  const suppressRef = useRef(false);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const eraserDisposerRef = useRef<(() => void) | null>(null);
  const eraserRef = useRef<EraserBrush | null>(null);
  const shapeToolRef = useRef<ShapeToolHandle | null>(null);
  // 2 本指ジェスチャが始まったら、その down から始まるタップ発火を見送る
  const suppressTapRef = useRef(false);
  const historyRef = useRef<DrawHistory>(createHistory(""));

  const [size, setSize] = useState<CanvasSize | null>(null);

  // 論理サイズを表示領域に収める倍率。canvas 全体が見えていないと
  // 描いた端が確かめられないので、幅と高さの両方を満たす方に合わせる
  const fitScale =
    size && availableWidth > 0 && availableHeight > 0
      ? Math.min(
          availableWidth / size.width,
          availableHeight / size.height,
          MAX_DISPLAY_SCALE,
        )
      : 1;
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
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [isEmpty, setIsEmpty] = useState(true);
  const [layerCounts, setLayerCounts] = useState<Record<LayerId, number>>({
    1: 0,
    2: 0,
    3: 0,
  });

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

  // 消しゴムを手放す。@erase2d の dispose は効果用の裏 canvas を 0×0 にして
  // GC に返すためのもので、呼ばないと捨てたブラシのぶんだけメモリが残る
  const releaseEraser = useCallback(() => {
    eraserDisposerRef.current?.();
    eraserDisposerRef.current = null;
    eraserRef.current?.dispose();
    eraserRef.current = null;
  }, []);

  // いまのブラシに色と太さを当てる。**ブラシは作り直さない** ——
  // EraserBrush は生成時に canvas 1 枚ぶんのメモリを確保するので、
  // 太さを変えるたびに作り直すと確保と破棄を繰り返すことになる
  const applyBrushStyle = useCallback(() => {
    const brush = fcRef.current?.freeDrawingBrush;
    if (!brush) {
      return;
    }
    const width = widthRef.current;
    // 内容の大きさなので fitScale で割る (拡大しても論理サイズは変えない)
    const scale = fitScaleRef.current;
    if (toolRef.current === "eraser") {
      // 消しゴムに色は無い (下を消すだけ)
      brush.width = toCanvasUnits(Math.max(MIN_ERASER_WIDTH, width * ERASER_SCALE), scale);
      return;
    }
    if (toolRef.current === "marker") {
      brush.width = toCanvasUnits(width * MARKER_SCALE, scale);
      brush.color = markerColor(colorRef.current);
      return;
    }
    brush.width = toCanvasUnits(width, scale);
    brush.color = colorRef.current;
  }, [colorRef, fitScaleRef, toolRef, widthRef]);

  // 選択枠を「白い紙の上でも見える」見た目にする。色は固定だが、太さと角の
  // 大きさは表示倍率で変わるので、倍率が動くたびに当て直す。
  // 複数選択 (ActiveSelection) は fabric が内部で作るオブジェクトなので、
  // selection:created でも同じものを当てる (呼び手は applySelectionStyle 経由)
  const styleForSelection = useCallback((object: fabric.FabricObject) => {
    const scale = displayScaleRef.current;
    object.set({
      borderColor: SELECTION_COLOR,
      cornerColor: "#ffffff",
      cornerStrokeColor: SELECTION_COLOR,
      transparentCorners: false,
      borderScaleFactor: toCanvasUnits(SELECTION_BORDER_PX, scale),
      cornerSize: toCanvasUnits(SELECTION_CORNER_PX, scale),
      touchCornerSize: toCanvasUnits(SELECTION_TOUCH_CORNER_PX, scale),
    });
  }, [displayScaleRef]);

  const applySelectionStyle = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) {
      return;
    }
    fc.forEachObject(styleForSelection);
    const active = fc.getActiveObject();
    if (active) {
      styleForSelection(active);
    }
    // 複数選択のドラッグ枠 (ラバーバンド) も同じ縮みを受けるので合わせて太らせる
    fc.selectionColor = "rgba(37, 99, 235, 0.1)";
    fc.selectionBorderColor = SELECTION_COLOR;
    fc.selectionLineWidth = toCanvasUnits(1.5, displayScaleRef.current);
    fc.requestRenderAll();
  }, [displayScaleRef, styleForSelection]);

  // 空判定とレイヤ別オブジェクト数をまとめて出し直す。オブジェクトが増減する
  // 節目 (描いた・戻した・全消し) で呼ぶ。layer は @erase2d の erasable と同じ
  // 拡張プロパティで、古いスナップショットや素の図形には無いので 1 に倒す
  const refreshStats = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) {
      return;
    }
    const objects = fc.getObjects();
    setIsEmpty(objects.length === 0);
    const counts: Record<LayerId, number> = { 1: 0, 2: 0, 3: 0 };
    for (const object of objects) {
      const layer = ((object as { layer?: LayerId }).layer ?? 1) as LayerId;
      counts[layer] += 1;
    }
    setLayerCounts(counts);
  }, []);

  // レイヤ状態 (アクティブ・非表示) を全オブジェクトのフラグへ落とし込む。
  // 当て直しの口はここ 1 つに集約する (docs/50 §3-2) —— レイヤ変更時・道具の
  // 切り替え時・履歴からの復元後の 3 箇所から呼ぶ。visible/erasable/selectable の
  // 導出は純関数 layerFlags に委ねる
  const applyLayerState = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) {
      return;
    }
    const state = layerStateRef.current;
    const isSelect = toolRef.current === "select";
    fc.forEachObject((object) => {
      const layer = ((object as { layer?: LayerId }).layer ?? 1) as LayerId;
      const flags = layerFlags(layer, state, isSelect);
      object.visible = flags.visible;
      object.set("erasable", flags.erasable);
      object.selectable = flags.selectable;
      object.evented = flags.selectable;
    });
    if (isSelect) {
      applySelectionStyle();
    } else {
      fc.discardActiveObject();
    }
    fc.requestRenderAll();
  }, [applySelectionStyle, layerStateRef, toolRef]);

  const syncHistoryState = useCallback((history: DrawHistory) => {
    historyRef.current = history;
    setHistoryState({ canUndo: historyCanUndo(history), canRedo: historyCanRedo(history) });
  }, []);

  const snapshot = useCallback((): string => {
    const fc = fcRef.current;
    // layer も残す。無いと戻したときに全部がレイヤ 1 へ落ちる (docs/50 §7)
    return fc ? JSON.stringify(fc.toObject(["erasable", "layer"])) : "";
  }, []);

  // 変更が落ち着いたら 1 手として履歴に積む
  const scheduleSnapshot = useCallback(() => {
    if (suppressRef.current) {
      return;
    }
    clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      const fc = fcRef.current;
      if (!fc) {
        return;
      }
      syncHistoryState(pushHistory(historyRef.current, snapshot()));
      refreshStats();
    }, SNAPSHOT_DEBOUNCE_MS);
  }, [snapshot, syncHistoryState, refreshStats]);

  // 履歴のスナップショットを canvas へ戻す
  const applyEntry = useCallback(async (entry: string) => {
    const fc = fcRef.current;
    if (!fc || !entry) {
      return;
    }
    // 予約済みのスナップショットを捨てる。戻した結果をそのまま積み直すと
    // やり直しの先を失う
    clearTimeout(snapshotTimerRef.current);
    suppressRef.current = true;
    try {
      await fc.loadFromJSON(JSON.parse(entry));
      // 流し込んだ直後は visible/erasable/selectable が既定に戻っているので、
      // いまのレイヤ状態と道具に合わせ直す (docs/50 §3-2 の当て直し 3 箇所目)
      applyLayerState();
      refreshStats();
    } catch {
      // 壊れたスナップショットは捨てる (いまの絵はそのまま残る)
    } finally {
      suppressRef.current = false;
    }
  }, [applyLayerState, refreshStats]);

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
      let image: fabric.FabricImage | null = null;
      let canvasSize: CanvasSize;
      // 白紙の器は開いた時点の枠だけで決める。描いている最中に画面を回して
      // 器を作り直すと、それまでの線の位置がずれるため、測るのは 1 度きり
      const rect = containerRef.current?.getBoundingClientRect();
      const blankSize = blankCanvasSize(rect?.width ?? 0, rect?.height ?? 0);

      if (backgroundUrl) {
        try {
          // 自前の画像 (同一オリジン) なので canvas は汚れず、書き出しもできる
          image = await fabric.FabricImage.fromURL(backgroundUrl, {
            crossOrigin: "anonymous",
          });
          canvasSize = canvasSizeForImage(image.width, image.height);
        } catch {
          setError("背景にする画像を読み込めませんでした。白紙で描けます。");
          image = null;
          canvasSize = blankSize;
        }
      } else {
        canvasSize = blankSize;
      }
      if (disposed) {
        return;
      }

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
      fcRef.current = fc;
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

      // 新しく描いたものにアクティブレイヤを刻み、その帯の末尾へ挿し込む
      // (docs/50 §3-1)。履歴・JSON から戻したものは自分の layer/erasable を
      // 持っているので触らない —— layer の有無で「新規か復元か」を見分ける
      fc.on("object:added", (event) => {
        const object = event.target;
        if (!object || (object as { layer?: unknown }).layer !== undefined) {
          return;
        }
        const active = layerStateRef.current.active;
        object.set("layer", active);
        // @erase2d が見る erasable の既定を立てる (fabric v7 の既定は未設定)。
        // 消せる/消せないの最終判断は applyLayerState がレイヤに応じて上書きする
        if ((object as { erasable?: unknown }).erasable === undefined) {
          object.set("erasable", true);
        }
        // 追加直後の object は列の末尾に居るので、それを除いた並びから
        // 帯の末尾位置を測って移す。moveObjectTo は object:added を出さない
        // (_onStackOrderChanged は再描画要求だけ) ので、ここで再帰しない
        const layers = fc
          .getObjects()
          .filter((other) => other !== object)
          .map((other) => ((other as { layer?: LayerId }).layer ?? 1) as LayerId);
        fc.moveObjectTo(object, insertionIndex(layers, active));
      });
      for (const name of [
        "object:added",
        "object:removed",
        "object:modified",
        "text:changed",
      ] as const) {
        fc.on(name, scheduleSnapshot);
      }

      // タップで即発火する道具 (文字・塗りつぶし) は **mouse:up** で発火する。
      // down で発火すると、2 本指ジェスチャの 1 本目の指でも発火してしまい、
      // ピンチのつもりが文字や塗りを置くことになる。up まで待ち、その間に
      // 2 本目が着いたら見送る (suppressTapRef)
      fc.on("mouse:down", () => {
        suppressTapRef.current = false;
      });

      // 文字道具: 何も無い所を押して離したら、その場に文字を置いて編集に入る
      fc.on("mouse:up", (options) => {
        if (toolRef.current !== "text" || options.target || suppressTapRef.current) {
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
          fill: colorRef.current,
          fontFamily: FONT_FAMILY,
          // 文字も内容なので fitScale 基準。拡大中に置いても、100% に
          // 戻したとき他の文字と同じ大きさになる
          fontSize: toCanvasUnits(
            Math.max(MIN_FONT_SIZE, widthRef.current * FONT_SCALE),
            fitScaleRef.current,
          ),
          erasable: true,
        });
        fc.add(text);
        fc.setActiveObject(text);
        text.enterEditing();
        text.hiddenTextarea?.focus();
      });
      // 複数選択は fabric が ActiveSelection を内部で作るので、
      // 出来たその場で選択枠のスタイルを当てる
      fc.on("selection:created", applySelectionStyle);

      // 空のまま編集を抜けたら消す (見えないゴミを残さない)
      fc.on("text:editing:exited", (event) => {
        const text = event.target;
        if (text && !String(text.text ?? "").trim()) {
          fc.remove(text);
        }
      });

      // 塗りつぶし: クリックした点と繋がった範囲を塗る (docs/35)。
      // 結果は 1 枚のオブジェクトとして足すので、履歴も消しゴムも
      // object:added の既存経路に乗る
      fc.on("mouse:up", (options) => {
        if (toolRef.current !== "fill" || suppressTapRef.current) {
          return;
        }
        const point = fc.getScenePoint(options.e);
        void buildFill(fc, point, colorRef.current)
          .then((filled) => {
            if (filled && fcRef.current === fc) {
              fc.add(filled);
              fc.requestRenderAll();
            }
          })
          .catch(() => {
            setError("塗りつぶせませんでした。");
          });
      });

      // 矢印・矩形・楕円のドラッグ描画 (docs/36 §1)。
      // ドラッグ中は仮の図形を出し入れするので履歴を止め、離したときに 1 手積む
      shapeToolRef.current = attachShapeTool(fc, {
        getTool: () => toolRef.current,
        getColor: () => colorRef.current,
        // 図形の線は内容 → fitScale。タップ判定は指の動き → displayScale
        getStrokeWidth: () => toCanvasUnits(widthRef.current, fitScaleRef.current),
        getMinDrag: () => toCanvasUnits(MIN_SHAPE_DRAG, displayScaleRef.current),
        beginPreview: () => {
          suppressRef.current = true;
        },
        endPreview: (commit) => {
          suppressRef.current = false;
          if (commit) {
            scheduleSnapshot();
          }
        },
        // モザイク: 囲んだ範囲の画素を升目の平均色に均して置き換える
        // (docs/36 §3)。塗りつぶしと同じラスタ経路
        onRegion: (region) => {
          void buildMosaic(fc, region)
            .then((mosaic) => {
              if (mosaic && fcRef.current === fc) {
                fc.add(mosaic);
                fc.requestRenderAll();
              }
            })
            .catch(() => {
              setError("モザイクを作れませんでした。");
            });
        },
      });

      fc.requestRenderAll();
      setSize(canvasSize);
      syncHistoryState(createHistory(JSON.stringify(fc.toObject(["erasable", "layer"]))));
      refreshStats();
      setIsPreparing(false);
    };

    void setup();

    return () => {
      disposed = true;
      clearTimeout(snapshotTimerRef.current);
      releaseEraser();
      shapeToolRef.current?.detach();
      shapeToolRef.current = null;
      const fc = fcRef.current;
      fcRef.current = null;
      void fc?.dispose();
    };
  }, [
    applySelectionStyle,
    backgroundUrl,
    canvasElRef,
    colorRef,
    containerRef,
    displayScaleRef,
    fitScaleRef,
    layerStateRef,
    refreshStats,
    releaseEraser,
    scheduleSnapshot,
    syncHistoryState,
    toolRef,
    widthRef,
  ]);

  // --- 道具の切り替え -----------------------------------------------------
  // ブラシを作り直すのは**道具が変わったときだけ**。色・太さの変更で作り直すと
  // 消しゴムのメモリ確保を繰り返すことになる (applyBrushStyle 参照)
  useEffect(() => {
    const fc = fcRef.current;
    if (!fc || isPreparing) {
      return;
    }
    fc.isDrawingMode = tool === "pen" || tool === "marker" || tool === "eraser";
    fc.selection = tool === "select";
    // 選択可否・消しゴムの効き先はレイヤ状態と道具から導く (docs/50 §3-2)。
    // 選択枠スタイルの当て直しと discardActiveObject もここに含まれる
    applyLayerState();

    if (tool === "pen" || tool === "marker") {
      // マーカーは色に alpha を載せた PencilBrush。**alpha < 1 のブラシは
      // needsFullRender() が真になり、消しゴムと同じ毎フレーム全再描画の
      // 経路に入る** (docs/36 §2)。docs/34 §3-2 の対策が効いている前提
      fc.freeDrawingBrush = new fabric.PencilBrush(fc);
    } else if (tool === "eraser") {
      const brush = new EraserBrush(fc);
      eraserRef.current = brush;
      fc.freeDrawingBrush = brush;
      // 消しゴムは object:* イベントを出さない (既存オブジェクトの clipPath を
      // 足すだけ) ので、専用の終了イベントから履歴を積む
      eraserDisposerRef.current = brush.on("end", () => scheduleSnapshot());
    } else {
      // 描かない道具のときはブラシを持たない (消しゴムの裏 canvas を抱えたままに
      // しない)
      fc.freeDrawingBrush = undefined;
    }
    applyBrushStyle();
    fc.requestRenderAll();

    return releaseEraser;
  }, [tool, isPreparing, scheduleSnapshot, applyBrushStyle, applyLayerState, releaseEraser]);

  // --- 色・太さ・表示倍率の反映 --------------------------------------------
  useEffect(() => {
    applyBrushStyle();
    // 拡大しながら選択しても、枠の太さが画面上で一定になるように当て直す
    applySelectionStyle();
  }, [color, width, displayScale, applyBrushStyle, applySelectionStyle]);

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

  const undo = useCallback(() => {
    const next = undoHistory(historyRef.current);
    if (next === historyRef.current) {
      return;
    }
    syncHistoryState(next);
    void applyEntry(currentEntry(next));
  }, [applyEntry, syncHistoryState]);

  const redo = useCallback(() => {
    const next = redoHistory(historyRef.current);
    if (next === historyRef.current) {
      return;
    }
    syncHistoryState(next);
    void applyEntry(currentEntry(next));
  }, [applyEntry, syncHistoryState]);

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
    const element = fc.toCanvasElement();
    const webp = await toBlob(element, "image/webp", WEBP_QUALITY);
    if (webp && webp.type === "image/webp") {
      return { blob: webp, extension: "webp" };
    }
    // WebP を書き出せないブラウザは PNG へ落とす (toBlob は非対応の形式を
    // 黙って PNG にすることがあるので、type を見てから決める)
    const png = await toBlob(element, "image/png");
    if (!png) {
      throw new Error("お絵かきを画像にできませんでした。");
    }
    return { blob: png, extension: "png" };
  }, []);

  return {
    size,
    displayScale,
    isPreparing,
    error,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    isEmpty,
    layerCounts,
    undo,
    redo,
    clear,
    exportImage,
    cancelActiveInput,
  };
}
