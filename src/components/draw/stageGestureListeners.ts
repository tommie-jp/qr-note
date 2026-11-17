"use client";

// 拡大・送りのジェスチャを枠の DOM イベントに結ぶ (docs/36-お絵かき拡張計画.md §4)。
// useStageGestures の effect から切り出した (docs/128 §8-1)。
//
// 状態遷移そのものは src/lib/draw/stageGestures.ts の純関数。ここは DOM の
// イベントを枠の座標に直して渡し、返った要求 (preventDefault・描きかけの
// 打ち切り・書き込み) を実行するだけ。

import { type RefObject, useEffect, useRef } from "react";
import {
  type GestureEvent,
  type GestureInput,
  IDLE_GESTURE,
  reduceStageGesture,
  type StageCommit,
  type StageView,
} from "@/lib/draw/stageGestures";
import type { PanOffset } from "@/lib/draw/zoom";
import type { DrawPoint } from "@/lib/draw/shapes";

export type GestureDispatch = (event: GestureEvent, domEvent: Event) => void;

interface GestureDispatchDeps {
  // 倍率・送りは state ではなく ref から渡す (useStageGestures の冒頭の注)
  readInput: () => GestureInput;
  onTwoFingerStart: () => void;
  commit: (commit: StageCommit) => void;
}

// 進行中のジェスチャを閉じ込めた dispatch を作る。作り直されない限り
// (= effect が張り直されない限り) ジェスチャの状態は生きる
export function createGestureDispatch({
  readInput,
  onTwoFingerStart,
  commit,
}: GestureDispatchDeps): GestureDispatch {
  let gesture = IDLE_GESTURE;
  return (event, domEvent) => {
    const result = reduceStageGesture(gesture, event, readInput());
    if (result.preventDefault) {
      // iOS Safari のページ自体の拡大に流さない
      domEvent.preventDefault();
    }
    if (result.twoFingerStart) {
      onTwoFingerStart();
    }
    gesture = result.state;
    if (result.commit) {
      commit(result.commit);
    }
  };
}

type StageListener = readonly [
  type: string,
  listener: (event: Event) => void,
  options?: AddEventListenerOptions,
];

// 枠の左上から測った指の位置
function localTouches(stage: HTMLElement, touches: TouchList): DrawPoint[] {
  const box = stage.getBoundingClientRect();
  return Array.from(touches, (touch) => ({
    x: touch.clientX - box.left,
    y: touch.clientY - box.top,
  }));
}

// 2 本指 (全道具) のリスナ
function touchListeners(stage: HTMLElement, dispatch: GestureDispatch): StageListener[] {
  const onTouchStart = (event: TouchEvent) => {
    // 2 本でなければ何も起きない (reduceStageGesture も同じ判定を持つ)。
    // 1 本指の描き始めのたびに枠を測らないための早抜け
    if (event.touches.length !== 2) {
      return;
    }
    dispatch({ type: "touchstart", touches: localTouches(stage, event.touches) }, event);
  };
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 2) {
      return;
    }
    dispatch({ type: "touchmove", touches: localTouches(stage, event.touches) }, event);
  };
  const onTouchEnd = (event: TouchEvent) => {
    dispatch({ type: "touchend", touchCount: event.touches.length }, event);
  };
  return [
    ["touchstart", onTouchStart as (event: Event) => void, { passive: false }],
    ["touchmove", onTouchMove as (event: Event) => void, { passive: false }],
    ["touchend", onTouchEnd as (event: Event) => void],
    ["touchcancel", onTouchEnd as (event: Event) => void],
  ];
}

// 1 本指ドラッグ (「移動」のみ。効くかどうかは reduceStageGesture が決める) のリスナ
function pointerListeners(dispatch: GestureDispatch): StageListener[] {
  const onPointerDown = (event: PointerEvent) => {
    dispatch({ type: "pointerdown", x: event.clientX, y: event.clientY }, event);
  };
  const onPointerMove = (event: PointerEvent) => {
    dispatch({ type: "pointermove", x: event.clientX, y: event.clientY }, event);
  };
  const endDrag = (event: PointerEvent) => {
    dispatch({ type: "pointerend" }, event);
  };
  return [
    ["pointerdown", onPointerDown as (event: Event) => void],
    ["pointermove", onPointerMove as (event: Event) => void],
    ["pointerup", endDrag as (event: Event) => void],
    ["pointercancel", endDrag as (event: Event) => void],
    ["pointerleave", endDrag as (event: Event) => void],
  ];
}

// 枠にリスナを張り、外す関数を返す。張る順・外す順は元の effect と同じ
// (touch 4 つ → pointer 5 つ)
export function listenStageGestures(
  stage: HTMLElement,
  dispatch: GestureDispatch,
): () => void {
  const listeners = [...touchListeners(stage, dispatch), ...pointerListeners(dispatch)];
  for (const [type, listener, options] of listeners) {
    stage.addEventListener(type, listener, options);
  }
  return () => {
    for (const [type, listener] of listeners) {
      stage.removeEventListener(type, listener);
    }
  };
}

interface StageGestureListenersParams {
  stageRef: RefObject<HTMLElement | null>;
  dragPanEnabled: boolean;
  onTwoFingerStart: () => void;
  readView: () => StageView;
  commit: (nextZoom: number, rawPan: PanOffset, fromZoom: number) => void;
}

// 2 本指 (全道具) と 1 本指ドラッグ (「移動」のみ) を枠に張る。
// 進行中のジェスチャは effect の中 (dispatch) に在るので、依存に zoom / pan を
// 入れない —— 1 目盛り動くたびに張り直されてジェスチャが死ぬ
export function useStageGestureListeners({
  stageRef,
  dragPanEnabled,
  onTwoFingerStart,
  readView,
  commit,
}: StageGestureListenersParams): void {
  const onTwoFingerStartRef = useRef(onTwoFingerStart);
  useEffect(() => {
    onTwoFingerStartRef.current = onTwoFingerStart;
  }, [onTwoFingerStart]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const dispatch = createGestureDispatch({
      readInput: () => ({ ...readView(), dragPanEnabled }),
      onTwoFingerStart: () => onTwoFingerStartRef.current(),
      commit: (next) => commit(next.zoom, next.pan, next.fromZoom),
    });
    return listenStageGestures(stage, dispatch);
  }, [commit, dragPanEnabled, readView, stageRef]);
}
