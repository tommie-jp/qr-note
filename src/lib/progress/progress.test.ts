import { describe, expect, test } from 'vitest'
import { aggregatePercent, bytesPercent, cappedPercent } from './progress'

describe('bytesPercent', () => {
  test('returns floored percent of loaded over total', () => {
    expect(bytesPercent(333, 1000)).toBe(33)
  })

  test('clamps to 0 when loaded is negative', () => {
    expect(bytesPercent(-1, 1000)).toBe(0)
  })

  test('clamps to 100 when loaded exceeds total', () => {
    expect(bytesPercent(1500, 1000)).toBe(100)
  })

  test('returns 0 when total is zero or negative', () => {
    expect(bytesPercent(500, 0)).toBe(0)
    expect(bytesPercent(500, -10)).toBe(0)
  })
})

describe('cappedPercent', () => {
  test('holds at the cap even when bytes reach 100%', () => {
    expect(cappedPercent(1000, 1000, 99)).toBe(99)
  })

  test('passes through below the cap', () => {
    expect(cappedPercent(400, 1000, 99)).toBe(40)
  })
})

describe('aggregatePercent', () => {
  test('sums loaded over summed totals once they exceed the expected total', () => {
    const downloads = [
      { loaded: 250, total: 1000 },
      { loaded: 250, total: 1000 },
    ]
    expect(aggregatePercent(downloads, 1500)).toBe(25)
  })

  test('uses the expected total when a Content-Length is missing', () => {
    const downloads = [
      { loaded: 500, total: 1000 },
      { loaded: 500, total: null },
    ]
    // (500 + 500) / 4000
    expect(aggregatePercent(downloads, 4000)).toBe(25)
  })

  // 逆走防止: 2 本目が登録される前に 1 本目だけで割ると % が落ちる
  test('never runs backward when a second download registers late', () => {
    const firstOnly = aggregatePercent([{ loaded: 4000, total: 4000 }], 20000)
    const bothKnown = aggregatePercent(
      [
        { loaded: 4000, total: 4000 },
        { loaded: 0, total: 16000 },
      ],
      20000,
    )
    expect(firstOnly).toBe(20)
    expect(bothKnown).toBeGreaterThanOrEqual(firstOnly)
  })

  test('clamps at 99 (compressed transfer can exceed Content-Length)', () => {
    const downloads = [{ loaded: 2000, total: 1000 }]
    expect(aggregatePercent(downloads, 1000)).toBe(99)
  })

  test('returns 0 for an empty download set', () => {
    expect(aggregatePercent([], 1000)).toBe(0)
  })
})
