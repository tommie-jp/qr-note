import { describe, expect, test } from 'vitest'

import { SORTS } from '@/lib/validation'
import type { OfflineItem } from './item'
import { sortOfflineItems } from './order'

function item(over: Partial<OfflineItem> = {}): OfflineItem {
  return {
    itemNo: '1',
    itemNoNum: 1,
    memo: '',
    url: '',
    mode: 'memo',
    title: '',
    tags: [],
    taskTodo: 0,
    taskDone: 0,
    updatedAt: '2026-08-01T00:00:00.000Z',
    accessedAt: '2026-08-01T00:00:00.000Z',
    pinned: false,
    ...over,
  }
}

const order = (items: OfflineItem[], sort: Parameters<typeof sortOfflineItems>[1]) =>
  sortOfflineItems(items, sort).map((i) => i.itemNo)

describe('sortOfflineItems', () => {
  test('既定 (updated) は更新の新しい順', () => {
    // Arrange
    const items = [
      item({ itemNo: 'a', updatedAt: '2026-08-01T00:00:00.000Z' }),
      item({ itemNo: 'b', updatedAt: '2026-08-03T00:00:00.000Z' }),
      item({ itemNo: 'c', updatedAt: '2026-08-02T00:00:00.000Z' }),
    ]

    // Act / Assert
    expect(order(items, 'updated')).toEqual(['b', 'c', 'a'])
    expect(order(items, 'updatedAsc')).toEqual(['a', 'c', 'b'])
  })

  test('番号順は数値で並べ、非数字は末尾へ回す', () => {
    const items = [
      item({ itemNo: '100x', itemNoNum: null }),
      item({ itemNo: '20', itemNoNum: 20 }),
      item({ itemNo: '100', itemNoNum: 100 }),
    ]
    expect(order(items, 'itemNo')).toEqual(['20', '100', '100x'])
    // 逆順でも非数字は末尾のまま (NULLS LAST は裏返さない)
    expect(order(items, 'itemNoDesc')).toEqual(['100', '20', '100x'])
  })

  test('アクセス順は同着を更新順で解く', () => {
    const items = [
      item({ itemNo: 'a', accessedAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }),
      item({ itemNo: 'b', accessedAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z' }),
    ]
    expect(order(items, 'accessed')).toEqual(['b', 'a'])
    expect(order(items, 'accessedAsc')).toEqual(['a', 'b'])
  })

  test('タイトル順は URL モードだけ url を鍵にする (一覧の見出しと揃える)', () => {
    const items = [
      item({ itemNo: 'a', title: 'ゼナー' }),
      item({ itemNo: 'b', mode: 'url', url: 'https://example.com', title: '' }),
    ]
    expect(order(items, 'title')).toEqual(['b', 'a'])
  })

  test('見出しの無いノートは向きに関わらず末尾', () => {
    const items = [
      item({ itemNo: 'a', title: '' }),
      item({ itemNo: 'b', title: 'B' }),
      item({ itemNo: 'c', title: 'C' }),
    ]
    expect(order(items, 'title')).toEqual(['b', 'c', 'a'])
    expect(order(items, 'titleDesc')).toEqual(['c', 'b', 'a'])
  })

  // 同着で並びが揺れると、開き直すたびに一覧の順が変わって前後ナビが迷子になる
  // (docs/15 §2-2)。どの並びも最後は itemNo で決着させる
  test('どの並びでも同着は itemNo の昇順で決着する', () => {
    const items = [item({ itemNo: 'c' }), item({ itemNo: 'a' }), item({ itemNo: 'b' })]
    for (const sort of SORTS) {
      expect(order(items, sort)).toEqual(['a', 'b', 'c'])
    }
  })

  test('元の配列を書き換えない (immutable)', () => {
    // Arrange
    const items = [item({ itemNo: 'b' }), item({ itemNo: 'a' })]

    // Act
    const sorted = sortOfflineItems(items, 'itemNo')

    // Assert
    expect(items.map((i) => i.itemNo)).toEqual(['b', 'a'])
    expect(sorted.map((i) => i.itemNo)).toEqual(['a', 'b'])
  })
})
