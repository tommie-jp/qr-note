// 2 本指・1 本指ドラッグ・ホイールの追跡 (docs/36-お絵かき拡張計画.md §4)。
//
// - **2 本指はどの道具でも効く**。開けば拡大、つまんだまま動かせば送り。
//   2 本目の指が着いた瞬間に描きかけの線を捨てさせる (twoFingerStart)
// - **1 本指ドラッグでの送りは「移動」道具のときだけ** (1 本指は描画のもの)
// - **ホイール (PC) もどの道具でも効く**。ポインタ位置を軸に拡大
//
// フック (src/components/draw/useStageGestures.ts) が DOM のイベントを枠の
// 座標に直して渡し、ここが「進行中のジェスチャの状態」と「書き込むべき倍率と
// 送り」を返す。DOM も React も触らない純粋な状態遷移なので、指の座標列を
// 与えてピンチ・ドラッグ・ホイールの出方を単体テストで固定できる
// (docs/96 §3-2 で切り出した)。
//
// 送りの上限 (clampPan) はここでは掛けない — 上限は拡大後の中身の実寸
// (DOM の測定) から決まるので、フック側の commit が掛ける。fromZoom は
// その見込み (倍率の比) のために返す。

import type { DrawPoint } from './shapes'
import {
  clampZoom,
  type PanOffset,
  panForPinch,
  panForZoom,
  pinchCenter,
  pinchSpan,
} from './zoom'

// ホイール 1 目盛り (deltaY ≒ 100) で約 1.22 倍。exp を使うのは、上下に
// 同じだけ回したときに正確に元の倍率へ戻るようにするため
export const WHEEL_SENSITIVITY = 0.002

// Firefox はホイールを「行数」(deltaMode = 1) で寄越すことがある。px 換算の係数
export const LINE_HEIGHT_PX = 33

// WheelEvent.DOM_DELTA_LINE の値。DOM の定数をここから読まないために持つ
const DOM_DELTA_LINE = 1

// いま画面に効いている倍率と送り (フックの zoomRef / panRef の中身)
export interface StageView {
  readonly zoom: number
  readonly pan: PanOffset
}

// 書き込みの要求。送りは上限を掛ける前の値
export interface StageCommit {
  readonly zoom: number
  readonly pan: PanOffset
  readonly fromZoom: number
}

// ポインタ位置を軸に拡大 (ホイール・ボタン用)
export function zoomAround(
  view: StageView,
  factor: number,
  pointer: DrawPoint,
): StageCommit {
  const next = clampZoom(view.zoom * factor)
  return {
    zoom: next,
    pan: panForZoom({ pan: view.pan, pointer, from: view.zoom, to: next }),
    fromZoom: view.zoom,
  }
}

// ホイールの回した量を倍率に直す
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const delta = deltaMode === DOM_DELTA_LINE ? deltaY * LINE_HEIGHT_PX : deltaY
  return Math.exp(-delta * WHEEL_SENSITIVITY)
}

// 進行中のピンチ。開き具合で倍率、中心の移動で送り。どちらも開始時を基準に
// 測る (直前フレーム基準だと誤差が積もって流れる)
export interface PinchState {
  readonly span: number
  readonly center: DrawPoint
  readonly zoom: number
  readonly pan: PanOffset
}

// 進行中の 1 本指ドラッグ。掴んだ位置 (client 座標) と、そのときの送り
export interface DragState {
  readonly x: number
  readonly y: number
  readonly pan: PanOffset
}

export interface GestureState {
  readonly pinch: PinchState | null
  readonly drag: DragState | null
}

export const IDLE_GESTURE: GestureState = { pinch: null, drag: null }

// フックが DOM のイベントから作る。touches は枠の左上から測った指の位置
export type GestureEvent =
  | { readonly type: 'touchstart'; readonly touches: readonly DrawPoint[] }
  | { readonly type: 'touchmove'; readonly touches: readonly DrawPoint[] }
  // 離した後に残っている指の数
  | { readonly type: 'touchend'; readonly touchCount: number }
  | { readonly type: 'pointerdown'; readonly x: number; readonly y: number }
  | { readonly type: 'pointermove'; readonly x: number; readonly y: number }
  | { readonly type: 'pointerend' }

export interface GestureInput extends StageView {
  // 「移動」道具か (1 本指ドラッグでの送りを受けるか)
  readonly dragPanEnabled: boolean
}

export interface GestureResult {
  readonly state: GestureState
  readonly commit: StageCommit | null
  // ブラウザ既定の処理 (iOS Safari のページ自体の拡大) に流さない
  readonly preventDefault: boolean
  // 2 本指ジェスチャが始まった。描きかけの線・図形を捨てさせる
  readonly twoFingerStart: boolean
}

function unchanged(state: GestureState): GestureResult {
  return { state, commit: null, preventDefault: false, twoFingerStart: false }
}

export function reduceStageGesture(
  state: GestureState,
  event: GestureEvent,
  input: GestureInput,
): GestureResult {
  switch (event.type) {
    case 'touchstart': {
      if (event.touches.length !== 2) {
        return unchanged(state)
      }
      const [a, b] = event.touches
      return {
        state: {
          drag: null,
          pinch: {
            span: pinchSpan(a, b),
            center: pinchCenter(a, b),
            zoom: input.zoom,
            pan: input.pan,
          },
        },
        commit: null,
        preventDefault: true,
        twoFingerStart: true,
      }
    }
    case 'touchmove': {
      const { pinch } = state
      if (!pinch || event.touches.length !== 2 || pinch.span <= 0) {
        return unchanged(state)
      }
      const [a, b] = event.touches
      const next = clampZoom(pinch.zoom * (pinchSpan(a, b) / pinch.span))
      const moved = panForPinch({
        pan: pinch.pan,
        from: pinch.zoom,
        startCenter: pinch.center,
        currentCenter: pinchCenter(a, b),
        to: next,
      })
      return {
        state,
        commit: { zoom: next, pan: moved, fromZoom: pinch.zoom },
        preventDefault: true,
        twoFingerStart: false,
      }
    }
    case 'touchend':
      return event.touchCount < 2 ? unchanged({ ...state, pinch: null }) : unchanged(state)
    case 'pointerdown':
      if (!input.dragPanEnabled || state.pinch) {
        return unchanged(state)
      }
      return unchanged({ ...state, drag: { x: event.x, y: event.y, pan: input.pan } })
    case 'pointermove': {
      const { drag } = state
      if (!drag || state.pinch) {
        return unchanged(state)
      }
      const moved = {
        left: drag.pan.left - (event.x - drag.x),
        top: drag.pan.top - (event.y - drag.y),
      }
      return {
        state,
        commit: { zoom: input.zoom, pan: moved, fromZoom: input.zoom },
        preventDefault: false,
        twoFingerStart: false,
      }
    }
    case 'pointerend':
      return unchanged({ ...state, drag: null })
  }
}
