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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type GestureEvent,
  IDLE_GESTURE,
  reduceStageGesture,
  wheelZoomFactor,
  zoomAround,
} from "@/lib/draw/stageGestures";
import { clampPan, MAX_ZOOM, MIN_ZOOM, type PanOffset } from "@/lib/draw/zoom";
import type { DrawPoint } from "@/lib/draw/shapes";

// +/- ボタン 1 回ぶんの倍率
const ZOOM_STEP = 1.5;

const NO_PAN: PanOffset = { left: 0, top: 0 };

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

export function useStageGestures({
  stageRef,
  contentRef,
  dragPanEnabled,
  onTwoFingerStart,
}: UseStageGesturesParams): StageGestures {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PanOffset>(NO_PAN);
  // ハンドラから読む最新値。state はレンダリング用で、ここが正
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const onTwoFingerStartRef = useRef(onTwoFingerStart);
  useEffect(() => {
    onTwoFingerStartRef.current = onTwoFingerStart;
  }, [onTwoFingerStart]);

  // 送りの上限は「拡大後の中身 − 枠」。中身は倍率を変えた後の寸法で測りたいが、
  // 変えた直後はまだ描き直されていないので、倍率の比から見込みで出す
  const limitFor = useCallback(
    (nextZoom: number, currentZoom: number) => {
      const stage = stageRef.current;
      const content = contentRef.current;
      if (!stage || !content) {
        return null;
      }
      const box = content.getBoundingClientRect();
      const ratio = currentZoom > 0 ? nextZoom / currentZoom : 1;
      return {
        content: { width: box.width * ratio, height: box.height * ratio },
        view: { width: stage.clientWidth, height: stage.clientHeight },
      };
    },
    [stageRef, contentRef],
  );

  // 唯一の書き込み口。ref と state を同時に更新して食い違いを作らない
  const commit = useCallback(
    (nextZoom: number, rawPan: PanOffset, fromZoom: number) => {
      const limit = limitFor(nextZoom, fromZoom);
      const nextPan = limit ? clampPan(rawPan, limit.content, limit.view) : rawPan;
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
    },
    [limitFor],
  );

  // ポインタ位置を軸に拡大 (ホイール・ボタン用)
  const zoomAt = useCallback(
    (factor: number, pointer: DrawPoint) => {
      const next = zoomAround(
        { zoom: zoomRef.current, pan: panRef.current },
        factor,
        pointer,
      );
      commit(next.zoom, next.pan, next.fromZoom);
    },
    [commit],
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

  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = NO_PAN;
    setZoom(1);
    setPan(NO_PAN);
  }, []);

  // --- 2 本指 (全道具) と 1 本指ドラッグ (「移動」のみ) --------------------
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    // 枠の左上から測った指の位置
    const localTouches = (touches: TouchList): DrawPoint[] => {
      const box = stage.getBoundingClientRect();
      return Array.from(touches, (touch) => ({
        x: touch.clientX - box.left,
        y: touch.clientY - box.top,
      }));
    };

    // 進行中のジェスチャ。effect が張り直されない限り生きる (依存に注意)
    let gesture = IDLE_GESTURE;

    // 状態遷移は純関数に任せ、返った要求だけを実行する。
    // 倍率・送りは state ではなく ref から渡す (上の注のとおり)
    const dispatch = (event: GestureEvent, domEvent: Event) => {
      const result = reduceStageGesture(gesture, event, {
        zoom: zoomRef.current,
        pan: panRef.current,
        dragPanEnabled,
      });
      if (result.preventDefault) {
        // iOS Safari のページ自体の拡大に流さない
        domEvent.preventDefault();
      }
      if (result.twoFingerStart) {
        onTwoFingerStartRef.current();
      }
      gesture = result.state;
      if (result.commit) {
        commit(result.commit.zoom, result.commit.pan, result.commit.fromZoom);
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      // 2 本でなければ何も起きない (reduceStageGesture も同じ判定を持つ)。
      // 1 本指の描き始めのたびに枠を測らないための早抜け
      if (event.touches.length !== 2) {
        return;
      }
      dispatch({ type: "touchstart", touches: localTouches(event.touches) }, event);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        return;
      }
      dispatch({ type: "touchmove", touches: localTouches(event.touches) }, event);
    };

    const onTouchEnd = (event: TouchEvent) => {
      dispatch({ type: "touchend", touchCount: event.touches.length }, event);
    };

    const onPointerDown = (event: PointerEvent) => {
      dispatch({ type: "pointerdown", x: event.clientX, y: event.clientY }, event);
    };

    const onPointerMove = (event: PointerEvent) => {
      dispatch({ type: "pointermove", x: event.clientX, y: event.clientY }, event);
    };

    const endDrag = (event: PointerEvent) => {
      dispatch({ type: "pointerend" }, event);
    };

    stage.addEventListener("touchstart", onTouchStart, { passive: false });
    stage.addEventListener("touchmove", onTouchMove, { passive: false });
    stage.addEventListener("touchend", onTouchEnd);
    stage.addEventListener("touchcancel", onTouchEnd);
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    stage.addEventListener("pointerleave", endDrag);

    return () => {
      stage.removeEventListener("touchstart", onTouchStart);
      stage.removeEventListener("touchmove", onTouchMove);
      stage.removeEventListener("touchend", onTouchEnd);
      stage.removeEventListener("touchcancel", onTouchEnd);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", endDrag);
      stage.removeEventListener("pointercancel", endDrag);
      stage.removeEventListener("pointerleave", endDrag);
    };
  }, [commit, dragPanEnabled, stageRef]);

  // --- ホイールで拡大 (PC・全道具) ----------------------------------------
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
