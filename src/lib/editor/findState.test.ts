import { describe, expect, test } from 'vitest'
import { FIND_SCROLL_GAP, FIND_SEED_MAX, findScrollMargin, findSeed } from './findState'

describe('findSeed', () => {
  test('短い 1 行の選択範囲はそのまま検索語にする', () => {
    expect(findSeed('抵抗', 'previous')).toBe('抵抗')
  })

  test('選択が無ければ直前の語を残す', () => {
    expect(findSeed('', 'previous')).toBe('previous')
  })

  // 帯に収まらず、消して打ち直す手間が増えるだけ
  test('長すぎる選択・複数行の選択は引き継がない', () => {
    // Arrange
    const long = 'x'.repeat(FIND_SEED_MAX + 1)

    // Act / Assert
    expect(findSeed(long, 'previous')).toBe('previous')
    expect(findSeed('a\nb', 'previous')).toBe('previous')
    expect(findSeed('x'.repeat(FIND_SEED_MAX), 'previous')).toBe('x'.repeat(FIND_SEED_MAX))
  })
})

describe('findScrollMargin', () => {
  // iOS はキーボードでレイアウトの高さを変えず、visualViewport だけが縮む
  test('帯の高さとキーボードの高さに少しの隙間を足す', () => {
    expect(findScrollMargin(56, 800, 500)).toBe(56 + 300 + FIND_SCROLL_GAP)
  })

  test('visualViewport が無ければキーボードは 0 とみなす', () => {
    expect(findScrollMargin(56, 800, null)).toBe(56 + FIND_SCROLL_GAP)
  })

  test('visualViewport のほうが高くても負にはしない', () => {
    expect(findScrollMargin(0, 700, 720)).toBe(FIND_SCROLL_GAP)
  })
})
