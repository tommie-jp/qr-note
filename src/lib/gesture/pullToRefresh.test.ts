import { describe, expect, test } from 'vitest'
import {
  PULL_MAX,
  PULL_THRESHOLD,
  beginPull,
  initialPullState,
  movePull,
  resolveRefresh,
} from './pullToRefresh'

// 座標列を流すヘルパ。start → move... の順に畳んで最終状態を返す。
// atTop は始点で先頭にいたか (省略時は先頭)。
function drag(
  points: Array<{ x: number; y: number }>,
  atTop = true,
) {
  let state = beginPull(initialPullState(), points[0].x, points[0].y, atTop)
  for (const p of points.slice(1)) {
    state = movePull(state, p.x, p.y)
  }
  return state
}

describe('beginPull', () => {
  test('先頭で触れれば tracking に入る', () => {
    const state = beginPull(initialPullState(), 100, 100, true)
    expect(state.phase).toBe('tracking')
  })

  test('先頭でなければ手を出さない (idle のまま)', () => {
    const state = beginPull(initialPullState(), 100, 100, false)
    expect(state.phase).toBe('idle')
  })
})

describe('方向ロック', () => {
  test('下向きがスロップを超えて縦に勝てば引っ張り開始', () => {
    const state = drag([
      { x: 100, y: 100 },
      { x: 103, y: 120 }, // dy=20, dx=3
    ])
    expect(state.phase).toBe('pulling')
    expect(state.distance).toBeGreaterThan(0)
  })

  test('上向きが勝てば手を引き上スクロールに譲る', () => {
    const state = drag([
      { x: 100, y: 100 },
      { x: 103, y: 80 }, // dy=-20 (上向き)
    ])
    expect(state.phase).toBe('idle')
  })

  test('横が勝てば手を引き横スワイプ (行削除) に譲る', () => {
    const state = drag([
      { x: 100, y: 100 },
      { x: 80, y: 103 }, // dx=-20, dy=3
    ])
    expect(state.phase).toBe('idle')
  })

  test('スロップ未満では判定を保留する (tracking のまま)', () => {
    const state = drag([
      { x: 100, y: 100 },
      { x: 102, y: 104 }, // dy=4 < SLOP
    ])
    expect(state.phase).toBe('tracking')
  })

  test('先頭でなければ下へ引いても反応しない', () => {
    const state = drag(
      [
        { x: 100, y: 100 },
        { x: 100, y: 200 },
      ],
      false,
    )
    expect(state.phase).toBe('idle')
    expect(state.distance).toBe(0)
  })
})

describe('引き量 (抵抗と上限)', () => {
  test('指の移動より軽く追従する (抵抗が掛かる)', () => {
    const state = drag([
      { x: 100, y: 100 },
      { x: 100, y: 200 }, // dy=100
    ])
    // 抵抗 0.5 なので 50px 前後。指の移動量 100 より必ず小さい。
    expect(state.distance).toBeLessThan(100)
    expect(state.distance).toBeGreaterThan(0)
  })

  test('大きく引いても上限で頭打ちになる', () => {
    const state = drag([
      { x: 100, y: 100 },
      { x: 100, y: 1000 }, // 大きく下へ
    ])
    expect(state.distance).toBe(PULL_MAX)
  })

  test('引っ張り中に指を戻すと引き量が縮む', () => {
    const state = drag([
      { x: 100, y: 100 },
      { x: 100, y: 220 }, // 深く引く
      { x: 100, y: 110 }, // 戻す (dy=10)
    ])
    expect(state.phase).toBe('pulling')
    expect(state.distance).toBeLessThan(PULL_THRESHOLD)
  })
})

describe('resolveRefresh (離したときの発火判定)', () => {
  test('しきい値以上まで引けていれば更新する', () => {
    expect(resolveRefresh({ phase: 'pulling', distance: PULL_THRESHOLD })).toBe(true)
  })

  test('しきい値未満なら更新しない', () => {
    expect(resolveRefresh({ phase: 'pulling', distance: PULL_THRESHOLD - 1 })).toBe(false)
  })

  test('引っ張りに入っていなければ更新しない', () => {
    expect(resolveRefresh({ phase: 'tracking', distance: PULL_MAX })).toBe(false)
  })
})
