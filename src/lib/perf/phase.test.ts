import { describe, expect, test } from 'vitest'
import { startPhases } from './phase'

// 呼ぶたびに進む偽の時計
function fakeClock(steps: number[]): () => number {
  let i = 0
  return () => steps[Math.min(i++, steps.length - 1)]
}

describe('startPhases', () => {
  test('計測していなければ fn の値だけ返し、done は null', async () => {
    const t = startPhases(false)
    await expect(t.time('検索', () => 42)).resolves.toBe(42)
    expect(t.timeSync('数式', () => 7)).toBe(7)
    expect(t.done()).toBeNull()
  })

  test('段階ごとの時間と全体を返す', async () => {
    // started=0, 検索 t0=10 end=13, 回路 t0=20 end=25, done=30
    const t = startPhases(true, fakeClock([0, 10, 13, 20, 25, 30]))
    await t.time('検索', () => 'a')
    await t.time('回路', async () => 'b')
    expect(t.done()).toEqual({ totalMs: 30, phases: { 検索: 3, 回路: 5 } })
  })

  test('並べた段階は終わった順ではなく始めた順に並ぶ', async () => {
    const t = startPhases(true)
    let release: () => void = () => {}
    const slow = t.time('遅い', () => new Promise<void>((resolve) => (release = resolve)))
    const fast = t.time('速い', () => 1)
    await fast
    release()
    await slow
    expect(Object.keys(t.done()?.phases ?? {})).toEqual(['遅い', '速い'])
  })

  test('fn が投げても時間は残り、例外はそのまま伝わる', async () => {
    const t = startPhases(true, fakeClock([0, 1, 4, 9]))
    await expect(
      t.time('検索', () => {
        throw new Error('失敗')
      }),
    ).rejects.toThrow('失敗')
    expect(t.done()?.phases).toEqual({ 検索: 3 })
  })

  test('timeSync は同期のまま値を返し、時間を残す', () => {
    const t = startPhases(true, fakeClock([0, 2, 9, 10]))
    expect(t.timeSync('数式', () => 'x')).toBe('x')
    expect(t.done()).toEqual({ totalMs: 10, phases: { 数式: 7 } })
  })
})
