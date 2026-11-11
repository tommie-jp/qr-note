import { describe, expect, test } from 'vitest'
import { clampFraction, tabFraction, tabOffsetCss } from './paneTabPosition'

describe('tabFraction (境界のタブの位置、docs/86 §4-21)', () => {
  test('タブの中心がポインタに来る割合。範囲の外へは出ない', () => {
    // 範囲 100〜600 (500px)、タブ 48px → 動ける幅 452px
    expect(tabFraction(100 + 24, 100, 500, 48)).toBe(0)
    expect(tabFraction(100 + 24 + 226, 100, 500, 48)).toBeCloseTo(0.5)
    expect(tabFraction(0, 100, 500, 48)).toBe(0)
    expect(tabFraction(9999, 100, 500, 48)).toBe(1)
  })

  test('範囲がタブより短ければ真ん中', () => {
    expect(tabFraction(10, 0, 20, 48)).toBe(0.5)
  })
})

test('clampFraction は 0〜1 に止め、読めない値は真ん中', () => {
  expect(clampFraction(-1)).toBe(0)
  expect(clampFraction(2)).toBe(1)
  expect(clampFraction(Number.NaN)).toBe(0.5)
})

test('tabOffsetCss は範囲からタブの長さを引いた分に割合を掛ける', () => {
  expect(tabOffsetCss(0.25, '100%')).toBe('calc(0.25 * (100% - 3rem))')
})
