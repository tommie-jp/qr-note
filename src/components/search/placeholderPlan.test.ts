import { describe, expect, test } from 'vitest'
import { lastVisiblePage, planPlaceholders } from './placeholderPlan'

// 一覧の末尾に並べる空の枠の割り付け (docs/129 §1)
describe('planPlaceholders', () => {
  test('残りを上限まで、ページ (20 件) ごとの塊にする', () => {
    // Act
    const chunks = planPlaceholders({ loaded: 20, total: 75, page: 1, pageCount: 4, limit: 100 })

    // Assert
    expect(chunks).toEqual([
      { page: 2, count: 20 },
      { page: 3, count: 20 },
      { page: 4, count: 15 },
    ])
  })

  test('上限で切る', () => {
    // Act
    const chunks = planPlaceholders({ loaded: 20, total: 1000, page: 1, pageCount: 50, limit: 50 })

    // Assert
    expect(chunks).toEqual([
      { page: 2, count: 20 },
      { page: 3, count: 20 },
      { page: 4, count: 10 },
    ])
  })

  test('上限 0 (なし) や読み切った後は出さない', () => {
    expect(planPlaceholders({ loaded: 20, total: 75, page: 1, pageCount: 4, limit: 0 })).toEqual([])
    expect(planPlaceholders({ loaded: 75, total: 75, page: 4, pageCount: 4, limit: 100 })).toEqual([])
  })

  test('重複を落として件数がずれても、最後のページを越えない', () => {
    // Act: 20 件のはずが 19 件しか出ていない (OFFSET の間に行が動いた)
    const chunks = planPlaceholders({ loaded: 19, total: 40, page: 1, pageCount: 2, limit: 100 })

    // Assert
    expect(chunks).toEqual([{ page: 2, count: 20 }])
  })
})

describe('lastVisiblePage', () => {
  test('見えている塊の最後のページ', () => {
    expect(lastVisiblePage(new Set([3, 2]))).toBe(3)
    expect(lastVisiblePage(new Set())).toBeNull()
  })
})
