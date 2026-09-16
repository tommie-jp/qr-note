import { describe, expect, test } from 'vitest'
import {
  type GestureState,
  IDLE_GESTURE,
  LINE_HEIGHT_PX,
  reduceStageGesture,
  WHEEL_SENSITIVITY,
  wheelZoomFactor,
  zoomAround,
} from './stageGestures'
import { MAX_ZOOM, MIN_ZOOM } from './zoom'

// 2 本指・1 本指ドラッグ・ホイールの状態遷移 (docs/36-お絵かき拡張計画.md §4)。
// useStageGestures から切り出した純関数に指の座標列を与え、倍率・送り・
// 打ち切りの出方を固定する (docs/96 §3-2)。座標はすべて枠の左上から測った値

const FIT = { zoom: 1, pan: { left: 0, top: 0 } }
const PAN_TOOL = { ...FIT, dragPanEnabled: true }
const PEN_TOOL = { ...FIT, dragPanEnabled: false }

// 2 本指を (100,100)・(200,100) に置く (開き 100、中心 (150,100))
const TWO_FINGERS = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
]

const pinching = (input = PAN_TOOL): GestureState =>
  reduceStageGesture(IDLE_GESTURE, { type: 'touchstart', touches: TWO_FINGERS }, input).state

describe('wheelZoomFactor', () => {
  test('rolling up (negative deltaY) zooms in by exp(-deltaY × sensitivity)', () => {
    // Arrange & Act & Assert — 1 目盛り (100) で約 1.22 倍
    expect(wheelZoomFactor(-100, 0)).toBeCloseTo(Math.exp(100 * WHEEL_SENSITIVITY))
    expect(wheelZoomFactor(-100, 0)).toBeCloseTo(1.2214, 4)
  })

  test('rolling the same amount back returns exactly to the original zoom', () => {
    // Arrange & Act & Assert — exp を使う理由
    expect(wheelZoomFactor(100, 0) * wheelZoomFactor(-100, 0)).toBeCloseTo(1, 12)
  })

  test('converts line-mode deltas (Firefox) to pixels', () => {
    // Arrange & Act & Assert — deltaMode 1 の 3 行 = 3 × LINE_HEIGHT_PX px
    expect(wheelZoomFactor(-3, 1)).toBe(wheelZoomFactor(-3 * LINE_HEIGHT_PX, 0))
  })
})

describe('zoomAround', () => {
  test('keeps the point under the pointer still while zooming in', () => {
    // Arrange — 全体表示で (100, 50) を軸に 2 倍
    const view = FIT

    // Act
    const next = zoomAround(view, 2, { x: 100, y: 50 })

    // Assert — 中身の (100, 50) が 2 倍で (200, 100) に来るので、その差だけ送る
    expect(next).toEqual({ zoom: 2, pan: { left: 100, top: 50 }, fromZoom: 1 })
  })

  test('does not zoom past the limit', () => {
    // Arrange & Act
    const next = zoomAround({ zoom: 3, pan: { left: 0, top: 0 } }, 2, { x: 0, y: 0 })

    // Assert
    expect(next.zoom).toBe(MAX_ZOOM)
    expect(next.fromZoom).toBe(3)
  })

  test('does not zoom out past the whole canvas', () => {
    // Arrange & Act
    const next = zoomAround(FIT, 0.5, { x: 100, y: 100 })

    // Assert — 倍率も送りも動かない
    expect(next).toEqual({ zoom: MIN_ZOOM, pan: { left: 0, top: 0 }, fromZoom: 1 })
  })
})

describe('reduceStageGesture: two fingers (any tool)', () => {
  test('ignores a single-finger touch start', () => {
    // Arrange & Act
    const result = reduceStageGesture(
      IDLE_GESTURE,
      { type: 'touchstart', touches: [{ x: 10, y: 10 }] },
      PEN_TOOL,
    )

    // Assert — 1 本指は描画のもの。状態も既定の処理も触らない
    expect(result.state).toBe(IDLE_GESTURE)
    expect(result.commit).toBeNull()
    expect(result.preventDefault).toBe(false)
    expect(result.twoFingerStart).toBe(false)
  })

  test('a second finger starts a pinch, drops the drag, and asks to cancel the stroke', () => {
    // Arrange — 「移動」でドラッグ中に 2 本目が着く。倍率 2・送り (10, 20)
    const view = { zoom: 2, pan: { left: 10, top: 20 }, dragPanEnabled: true }
    const dragging = reduceStageGesture(
      IDLE_GESTURE,
      { type: 'pointerdown', x: 5, y: 5 },
      view,
    ).state

    // Act
    const result = reduceStageGesture(
      dragging,
      { type: 'touchstart', touches: TWO_FINGERS },
      view,
    )

    // Assert — 開始時の開き・中心・倍率・送りを控える。iOS のページ拡大に
    // 流さないため preventDefault、描きかけを捨てるため onTwoFingerStart
    expect(result.state).toEqual({
      drag: null,
      pinch: {
        span: 100,
        center: { x: 150, y: 100 },
        zoom: 2,
        pan: { left: 10, top: 20 },
      },
    })
    expect(result.commit).toBeNull()
    expect(result.preventDefault).toBe(true)
    expect(result.twoFingerStart).toBe(true)
  })

  test('spreading the fingers zooms in about the pinch centre', () => {
    // Arrange — 開き 100 → 200
    const state = pinching()

    // Act
    const result = reduceStageGesture(
      state,
      {
        type: 'touchmove',
        touches: [
          { x: 50, y: 100 },
          { x: 250, y: 100 },
        ],
      },
      PAN_TOOL,
    )

    // Assert — 倍率 2。中心 (150, 100) の下の点が動かないように送る
    expect(result.commit).toEqual({
      zoom: 2,
      pan: { left: 150, top: 100 },
      fromZoom: 1,
    })
    expect(result.preventDefault).toBe(true)
    expect(result.twoFingerStart).toBe(false)
    // 開始時の控えは動かさない (直前フレーム基準だと誤差が積もって流れる)
    expect(result.state).toBe(state)
  })

  test('pinching in does not zoom out past the whole canvas', () => {
    // Arrange — 倍率 2・送り (100, 100) から、開き 100 → 20 (5 分の 1)
    const view = { zoom: 2, pan: { left: 100, top: 100 }, dragPanEnabled: false }
    const state = pinching(view)

    // Act
    const result = reduceStageGesture(
      state,
      {
        type: 'touchmove',
        touches: [
          { x: 140, y: 100 },
          { x: 160, y: 100 },
        ],
      },
      view,
    )

    // Assert — 倍率は下限で止まり、送りは負にならない
    expect(result.commit).toEqual({
      zoom: MIN_ZOOM,
      pan: { left: 0, top: 0 },
      fromZoom: 2,
    })
  })

  test('spreading further than the limit stops at the maximum zoom', () => {
    // Arrange — 倍率 3 から開き 3 倍 (9 倍相当)
    const view = { zoom: 3, pan: { left: 0, top: 0 }, dragPanEnabled: false }
    const state = pinching(view)

    // Act
    const result = reduceStageGesture(
      state,
      {
        type: 'touchmove',
        touches: [
          { x: 0, y: 100 },
          { x: 300, y: 100 },
        ],
      },
      view,
    )

    // Assert
    expect(result.commit?.zoom).toBe(MAX_ZOOM)
    expect(result.commit?.fromZoom).toBe(3)
  })

  test('moving both fingers together pans so the content follows them', () => {
    // Arrange — 倍率 2・送り (100, 50)。開きはそのまま、中心を左上へ (20, 10)
    const view = { zoom: 2, pan: { left: 100, top: 50 }, dragPanEnabled: false }
    const state = pinching(view)

    // Act
    const result = reduceStageGesture(
      state,
      {
        type: 'touchmove',
        touches: [
          { x: 80, y: 90 },
          { x: 180, y: 90 },
        ],
      },
      view,
    )

    // Assert — 倍率は変わらず、指が動いた分だけ送りが増える
    expect(result.commit).toEqual({
      zoom: 2,
      pan: { left: 120, top: 60 },
      fromZoom: 2,
    })
  })

  test('a touch move without a pinch in progress does nothing', () => {
    // Arrange & Act — 3 本 → 2 本のように、開始を見ていない 2 本指
    const result = reduceStageGesture(
      IDLE_GESTURE,
      { type: 'touchmove', touches: TWO_FINGERS },
      PEN_TOOL,
    )

    // Assert
    expect(result.state).toBe(IDLE_GESTURE)
    expect(result.commit).toBeNull()
    expect(result.preventDefault).toBe(false)
  })

  test('a touch move with a different finger count does nothing', () => {
    // Arrange
    const state = pinching()

    // Act
    const result = reduceStageGesture(
      state,
      { type: 'touchmove', touches: [{ x: 10, y: 10 }] },
      PAN_TOOL,
    )

    // Assert
    expect(result.state).toBe(state)
    expect(result.commit).toBeNull()
    expect(result.preventDefault).toBe(false)
  })

  test('fingers that started on the same spot cannot zoom (no division by zero)', () => {
    // Arrange — 開き 0 で開始
    const same = { x: 100, y: 100 }
    const state = reduceStageGesture(
      IDLE_GESTURE,
      { type: 'touchstart', touches: [same, same] },
      PEN_TOOL,
    ).state

    // Act
    const result = reduceStageGesture(
      state,
      { type: 'touchmove', touches: TWO_FINGERS },
      PEN_TOOL,
    )

    // Assert
    expect(state.pinch?.span).toBe(0)
    expect(result.commit).toBeNull()
    expect(result.preventDefault).toBe(false)
  })

  test('lifting a finger ends the pinch; two fingers still down keep it', () => {
    // Arrange
    const state = pinching()

    // Act
    const stillTwo = reduceStageGesture(state, { type: 'touchend', touchCount: 2 }, PAN_TOOL)
    const one = reduceStageGesture(state, { type: 'touchend', touchCount: 1 }, PAN_TOOL)
    const none = reduceStageGesture(state, { type: 'touchend', touchCount: 0 }, PAN_TOOL)

    // Assert
    expect(stillTwo.state.pinch).not.toBeNull()
    expect(one.state.pinch).toBeNull()
    expect(none.state.pinch).toBeNull()
    for (const result of [stillTwo, one, none]) {
      expect(result.commit).toBeNull()
      expect(result.preventDefault).toBe(false)
      expect(result.twoFingerStart).toBe(false)
    }
  })
})

describe('reduceStageGesture: one-finger drag (pan tool only)', () => {
  test('pointer down starts a drag only when drag panning is enabled', () => {
    // Arrange & Act
    const pen = reduceStageGesture(IDLE_GESTURE, { type: 'pointerdown', x: 100, y: 100 }, PEN_TOOL)
    const pan = reduceStageGesture(
      IDLE_GESTURE,
      { type: 'pointerdown', x: 100, y: 100 },
      { zoom: 2, pan: { left: 30, top: 40 }, dragPanEnabled: true },
    )

    // Assert — 1 本指は描画のもの。「移動」道具のときだけ送りの起点を控える
    expect(pen.state).toBe(IDLE_GESTURE)
    expect(pan.state).toEqual({ pinch: null, drag: { x: 100, y: 100, pan: { left: 30, top: 40 } } })
    expect(pan.commit).toBeNull()
    expect(pan.preventDefault).toBe(false)
  })

  test('pointer down is ignored while pinching', () => {
    // Arrange
    const state = pinching()

    // Act
    const result = reduceStageGesture(state, { type: 'pointerdown', x: 1, y: 1 }, PAN_TOOL)

    // Assert
    expect(result.state).toBe(state)
  })

  test('dragging pans opposite to the pointer, measured from the origin', () => {
    // Arrange — 倍率 2・送り (30, 40) で (100, 100) から掴む
    const view = { zoom: 2, pan: { left: 30, top: 40 }, dragPanEnabled: true }
    const state = reduceStageGesture(IDLE_GESTURE, { type: 'pointerdown', x: 100, y: 100 }, view).state

    // Act
    const first = reduceStageGesture(state, { type: 'pointermove', x: 110, y: 95 }, view)
    const second = reduceStageGesture(first.state, { type: 'pointermove', x: 120, y: 90 }, view)

    // Assert — 右下へ動かすと中身が付いてくる = 送りは減る。倍率は据え置き
    expect(first.commit).toEqual({ zoom: 2, pan: { left: 20, top: 45 }, fromZoom: 2 })
    expect(second.commit).toEqual({ zoom: 2, pan: { left: 10, top: 50 }, fromZoom: 2 })
    expect(first.state).toBe(state)
    expect(first.preventDefault).toBe(false)
  })

  test('pointer move without a drag or during a pinch does nothing', () => {
    // Arrange — ピンチ中に drag が残っている形を組む (touchstart は drag を捨てるが、契約として)
    const both: GestureState = {
      ...pinching(),
      drag: { x: 0, y: 0, pan: { left: 0, top: 0 } },
    }

    // Act
    const idle = reduceStageGesture(IDLE_GESTURE, { type: 'pointermove', x: 5, y: 5 }, PAN_TOOL)
    const pinched = reduceStageGesture(both, { type: 'pointermove', x: 5, y: 5 }, PAN_TOOL)

    // Assert
    expect(idle.commit).toBeNull()
    expect(idle.state).toBe(IDLE_GESTURE)
    expect(pinched.commit).toBeNull()
    expect(pinched.state).toBe(both)
  })

  test('pointer end clears the drag', () => {
    // Arrange
    const state = reduceStageGesture(IDLE_GESTURE, { type: 'pointerdown', x: 1, y: 1 }, PAN_TOOL).state

    // Act
    const result = reduceStageGesture(state, { type: 'pointerend' }, PAN_TOOL)

    // Assert
    expect(result.state).toEqual({ pinch: null, drag: null })
    expect(result.commit).toBeNull()
  })
})

describe('reduceStageGesture: a whole gesture', () => {
  test('a pan drag is taken over by a pinch, which zooms and then ends cleanly', () => {
    // Arrange
    const view = { zoom: 1, pan: { left: 0, top: 0 }, dragPanEnabled: true }
    let state = IDLE_GESTURE

    // Act — 1 本指で掴む → 2 本目が着く → 開く → 1 本離す → 残りの指が動く
    const down = reduceStageGesture(state, { type: 'pointerdown', x: 100, y: 100 }, view)
    state = down.state
    const start = reduceStageGesture(state, { type: 'touchstart', touches: TWO_FINGERS }, view)
    state = start.state
    const move = reduceStageGesture(
      state,
      {
        type: 'touchmove',
        touches: [
          { x: 50, y: 100 },
          { x: 250, y: 100 },
        ],
      },
      view,
    )
    state = move.state
    const end = reduceStageGesture(state, { type: 'touchend', touchCount: 1 }, view)
    state = end.state
    const after = reduceStageGesture(state, { type: 'pointermove', x: 130, y: 100 }, view)

    // Assert — 打ち切りは 2 本目が着いた 1 回だけ。離した後の 1 本指は
    // ドラッグを引き継がない (touchstart で捨てている)
    expect([down, start, move, end, after].map((r) => r.twoFingerStart)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ])
    expect(move.commit?.zoom).toBe(2)
    expect(state).toEqual({ pinch: null, drag: null })
    expect(after.commit).toBeNull()
  })
})
