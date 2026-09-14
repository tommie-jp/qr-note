import { describe, expect, test } from 'vitest'
import {
  SWIPE_BUTTON_WIDTH,
  SWIPE_MAX_OFFSET,
  beginSwipe,
  initialSwipeState,
  moveSwipe,
  resolveOpen,
  settleSwipe,
} from './swipeRow'

// 座標列を流すヘルパ。down → move... の順に畳んで最終状態を返す。
function drag(
  open: boolean,
  points: Array<{ x: number; y: number; t: number }>,
) {
  let state = beginSwipe(initialSwipeState(open), points[0].x, points[0].y, points[0].t)
  for (const p of points.slice(1)) {
    state = moveSwipe(state, p.x, p.y, p.t)
  }
  return state
}

describe('initialSwipeState', () => {
  test('閉じているときは offset 0', () => {
    expect(initialSwipeState(false).offset).toBe(0)
  })

  test('開いているときはボタン幅ぶん左へずらす', () => {
    expect(initialSwipeState(true).offset).toBe(-SWIPE_BUTTON_WIDTH)
  })
})

describe('方向ロック', () => {
  test('横がスロップを超えて縦に勝てばドラッグ開始', () => {
    const state = drag(false, [
      { x: 100, y: 100, t: 0 },
      { x: 80, y: 103, t: 16 }, // dx=-20, dy=3
    ])
    expect(state.phase).toBe('dragging')
    expect(state.dragged).toBe(true)
  })

  test('縦が勝てば手を引き縦スクロールに譲る', () => {
    const state = drag(false, [
      { x: 100, y: 100, t: 0 },
      { x: 103, y: 80, t: 16 }, // dy 優勢
    ])
    expect(state.phase).toBe('idle')
    expect(state.dragged).toBe(false)
  })

  test('スロップ未満では判定を保留する (tracking のまま)', () => {
    const state = drag(false, [
      { x: 100, y: 100, t: 0 },
      { x: 96, y: 98, t: 16 }, // |dx|=4 < SLOP
    ])
    expect(state.phase).toBe('tracking')
  })
})

describe('offset のクランプ', () => {
  test('右方向 (閉じた状態) は 0 より右へ動かない', () => {
    const state = drag(false, [
      { x: 100, y: 100, t: 0 },
      { x: 130, y: 100, t: 16 }, // 右へ 30 … でも横ロックはする
      { x: 200, y: 100, t: 32 },
    ])
    expect(state.offset).toBe(0)
  })

  test('左方向はゴム余白まで (ボタン幅を超えて引けない)', () => {
    const state = drag(false, [
      { x: 300, y: 100, t: 0 },
      { x: 0, y: 100, t: 16 }, // 大きく左へ
    ])
    expect(state.offset).toBe(SWIPE_MAX_OFFSET)
  })

  test('開いた状態から右へ引くと 0 に向かって閉じられる', () => {
    const state = drag(true, [
      { x: 100, y: 100, t: 0 },
      { x: 100 + SWIPE_BUTTON_WIDTH, y: 100, t: 16 }, // ちょうどボタン幅ぶん右
    ])
    expect(state.offset).toBe(0)
  })
})

describe('resolveOpen (離したときの開閉判定)', () => {
  test('ボタン幅の半分より深ければ開く', () => {
    const open = resolveOpen({
      offset: -(SWIPE_BUTTON_WIDTH / 2) - 1,
      velocity: 0,
    })
    expect(open).toBe(true)
  })

  test('半分未満なら閉じる', () => {
    const open = resolveOpen({
      offset: -(SWIPE_BUTTON_WIDTH / 2) + 1,
      velocity: 0,
    })
    expect(open).toBe(false)
  })

  test('浅くても左向きの速度が十分なら開く', () => {
    const open = resolveOpen({ offset: -10, velocity: -0.5 })
    expect(open).toBe(true)
  })

  test('深くても右向きの速度が十分なら閉じる (勢いで閉じる)', () => {
    const open = resolveOpen({ offset: -60, velocity: 0.5 })
    expect(open).toBe(false)
  })
})

describe('settleSwipe (スナップ)', () => {
  test('開くと決めたらボタン幅へ、閉じるなら 0 へ揃える', () => {
    const opened = settleSwipe(true)
    const closed = settleSwipe(false)
    expect(opened.offset).toBe(-SWIPE_BUTTON_WIDTH)
    expect(closed.offset).toBe(0)
    expect(opened.phase).toBe('idle')
    expect(closed.phase).toBe('idle')
  })
})
