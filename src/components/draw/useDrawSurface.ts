"use client";

// お絵かきの描く面 (拡大・送りと fabric の canvas) を結ぶ。
// DrawModal から切り出した (docs/128 §8-1)。effect の並びは元の DrawModal と
// 同じ (ジェスチャ → canvas → 打ち切り関数の控え → 領域の測定 → スクロール 0)。

import { type RefObject, useEffect, useRef, useState } from "react";
import { type DrawCanvasApi, useDrawCanvas } from "./useDrawCanvas";
import type { DrawSession } from "./useDrawSession";
import { type StageGestures, useStageGestures } from "./useStageGestures";

export interface StageArea {
  width: number;
  height: number;
}

// 画面の回転やキーボードの開閉で描画領域が変わっても、canvas 全体が
// 収まるように表示だけを拡縮する (論理サイズ = 書き出す解像度は変えない)
function useStageAreaObserver(
  stageRef: RefObject<HTMLElement | null>,
  setArea: (area: StageArea) => void,
) {
  useEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setArea({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [setArea, stageRef]);
}

// **枠のスクロール量は常に 0 に保つ**。overflow: hidden でも、中の要素に
// 焦点が移るとブラウザは「見える位置まで送る」ためにスクロールさせる
// (文字道具は fabric の隠し textarea に焦点を当てる)。ここが 0 でなくなると
// fabric の座標がその分ずれる (docs/36 §4-3)
function useStageScrollReset(stageRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const reset = () => {
      if (stage.scrollLeft !== 0 || stage.scrollTop !== 0) {
        stage.scrollLeft = 0;
        stage.scrollTop = 0;
      }
    };
    stage.addEventListener("scroll", reset);
    return () => stage.removeEventListener("scroll", reset);
  }, [stageRef]);
}

interface UseDrawSurfaceParams {
  stageRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  canvasElRef: RefObject<HTMLCanvasElement | null>;
  session: Pick<DrawSession, "tool" | "prefs" | "layerState">;
  // 下敷きの URL。白紙なら null
  backgroundUrl: string | null;
}

export interface DrawSurface {
  canvas: DrawCanvasApi;
  gestures: StageGestures;
  area: StageArea;
}

export function useDrawSurface(params: UseDrawSurfaceParams): DrawSurface {
  const { stageRef, contentRef, canvasElRef, session } = params;
  const [area, setArea] = useState<StageArea>({ width: 0, height: 0 });

  // 拡大と送り (docs/36 §4)。2 本指とホイールはどの道具でも効き、
  // 1 本指ドラッグでの送りだけ「移動」道具に限る。
  // 2 本指の開始時には描きかけの線を捨てる — その関数は useDrawCanvas から
  // 出てくるが、useDrawCanvas はこのフックの zoom を受けるので、
  // 相互参照を ref で切る
  const cancelInputRef = useRef<() => void>(() => undefined);
  const gestures = useStageGestures({
    stageRef,
    contentRef,
    dragPanEnabled: session.tool === "pan",
    onTwoFingerStart: () => cancelInputRef.current(),
  });

  const canvas = useDrawCanvas({
    tool: session.tool,
    color: session.prefs.color,
    width: session.prefs.width,
    backgroundUrl: params.backgroundUrl,
    availableWidth: area.width,
    availableHeight: area.height,
    zoom: gestures.zoom,
    layerState: session.layerState,
    canvasElRef,
    containerRef: stageRef,
  });

  // ジェスチャ側 (レンダー順で先に居る) から最新の打ち切り関数を呼べるようにする
  const { cancelActiveInput } = canvas;
  useEffect(() => {
    cancelInputRef.current = cancelActiveInput;
  }, [cancelActiveInput]);

  useStageAreaObserver(stageRef, setArea);
  useStageScrollReset(stageRef);

  return { canvas, gestures, area };
}
