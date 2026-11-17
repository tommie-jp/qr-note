"use client";

// 拡大と送り (docs/36-お絵かき拡張計画.md §4)。
//
// - **2 本指はどの道具でも効く**。開けば拡大、つまんだまま動かせば送り。
//   2 本目の指が着いた瞬間に onTwoFingerStart で描きかけの線を捨てさせる
//   ので、描く道具と取り合いにならない
// - **1 本指ドラッグでの送りは「移動」道具のときだけ** (1 本指は描画のもの)
// - **ホイール (PC) もどの道具でも効く**。ポインタ位置を軸に拡大
//
// 送りは transform であって scroll ではない (zoom.ts の冒頭を参照)。
//
// 実装の要: **ハンドラは state を閉じ込めず ref を読む**。進行中のピンチや
// ドラッグの状態は effect のローカルに在るので、依存に zoom / pan を入れると
// 1 目盛り動くたびにリスナが張り直されてジェスチャが死ぬ (実際に起きた不具合)。
//
// 指の座標から倍率・送り・打ち切りを決める状態遷移そのものは
// src/lib/draw/stageGestures.ts の純関数 (reduceStageGesture・zoomAround・
// wheelZoomFactor)。ここは DOM のイベントを枠の座標に直して渡し、返った要求
// (preventDefault・描きかけの打ち切り・書き込み) を実行する (docs/96 §3-2)。
// 倍率と送りの持ち方は useStageView、DOM への結線は stageGestureListeners
// (docs/128 §8-1 で分けた)。

import { useCallback, useEffect } from "react";
import { wheelZoomFactor, zoomAround } from "@/lib/draw/stageGestures";
import { MAX_ZOOM, MIN_ZOOM, type PanOffset } from "@/lib/draw/zoom";
import type { DrawPoint } from "@/lib/draw/shapes";
import { useStageGestureListeners } from "./stageGestureListeners";
import { useStageView } from "./useStageView";

// +/- ボタン 1 回ぶんの倍率
const ZOOM_STEP = 1.5;

interface UseStageGesturesParams {
  // ジェスチャを受ける枠 (canvas を囲む見えている範囲)
  stageRef: React.RefObject<HTMLElement | null>;
  // 拡大した中身そのもの。送りの上限を測るのに使う
  contentRef: React.RefObject<HTMLElement | null>;
  // 「移動」道具か (1 本指ドラッグでの送りを受けるか)
  dragPanEnabled: boolean;
  // 2 本指ジェスチャが始まった瞬間に呼ぶ。1 本目の指で始まってしまった
  // 描きかけの線・図形を捨てるため
  onTwoFingerStart: () => void;
}

export interface StageGestures {
  zoom: number;
  pan: PanOffset;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomStep: number;
}

// --- ホイールで拡大 (PC・全道具) ----------------------------------------
function useWheelZoom(
  stageRef: React.RefObject<HTMLElement | null>,
  zoomAt: (factor: number, pointer: DrawPoint) => void,
) {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      // ブラウザ自体の拡大 (Ctrl+ホイール) や後ろのページのスクロールに流さない
      event.preventDefault();
      const box = stage.getBoundingClientRect();
      zoomAt(wheelZoomFactor(event.deltaY, event.deltaMode), {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [stageRef, zoomAt]);
}

export function useStageGestures({
  stageRef,
  contentRef,
  dragPanEnabled,
  onTwoFingerStart,
}: UseStageGesturesParams): StageGestures {
  const { zoom, pan, readView, commit, resetZoom } = useStageView(stageRef, contentRef);

  // ポインタ位置を軸に拡大 (ホイール・ボタン用)
  const zoomAt = useCallback(
    (factor: number, pointer: DrawPoint) => {
      const next = zoomAround(readView(), factor, pointer);
      commit(next.zoom, next.pan, next.fromZoom);
    },
    [commit, readView],
  );

  // 枠の中心を軸に拡大 (ボタン用)
  const zoomBy = useCallback(
    (factor: number) => {
      const stage = stageRef.current;
      if (!stage) {
        return;
      }
      zoomAt(factor, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
    },
    [stageRef, zoomAt],
  );

  // --- 2 本指 (全道具) と 1 本指ドラッグ (「移動」のみ) --------------------
  useStageGestureListeners({ stageRef, dragPanEnabled, onTwoFingerStart, readView, commit });
  useWheelZoom(stageRef, zoomAt);

  return {
    zoom,
    pan,
    zoomBy,
    resetZoom,
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > MIN_ZOOM,
    zoomStep: ZOOM_STEP,
  };
}
