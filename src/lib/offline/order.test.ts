import { describe, expect, test } from 'vitest'

import { SORTS } from '@/lib/validation'
import type { OfflineItem } from './item'
import { sortOfflineItems } from './order'

function item(over: Partial<OfflineItem> = {}): OfflineItem {
  return {
    itemId: '1',
    memo: '',
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
  sortOfflineItems(items, sort).map((i) => i.itemId)

describe('sortOfflineItems', () => {
  test('既定 (updated) は更新の新しい順', () => {
    // Arrange
    const items = [
      item({ itemId: 'a', updatedAt: '2026-08-01T00:00:00.000Z' }),
      item({ itemId: 'b', updatedAt: '2026-08-03T00:00:00.000Z' }),
      item({ itemId: 'c', updatedAt: '2026-08-02T00:00:00.000Z' }),
    ]

    // Act / Assert
    expect(order(items, 'updated')).toEqual(['b', 'c', 'a'])
    expect(order(items, 'updatedAsc')).toEqual(['a', 'c', 'b'])
  })

  test('登録順は id (UUID v7) の辞書順 = 作った順', () => {
    const items = [
      item({ itemId: '01a14845-dc63-73d4-bc31-66db9f239576' }),
      item({ itemId: '01a14845-dc5e-7f0e-8221-1c59b2f44330' }),
      item({ itemId: '01a14845-dc61-7c5e-864f-8245766fb2b7' }),
    ]
    expect(order(items, 'registered')).toEqual([
      '01a14845-dc5e-7f0e-8221-1c59b2f44330',
      '01a14845-dc61-7c5e-864f-8245766fb2b7',
      '01a14845-dc63-73d4-bc31-66db9f239576',
    ])
    expect(order(items, 'registeredDesc')[0]).toBe('01a14845-dc63-73d4-bc31-66db9f239576')
  })

  test('アクセス順は同着を更新順で解く', () => {
    const items = [
      item({ itemId: 'a', accessedAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }),
      item({ itemId: 'b', accessedAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z' }),
    ]
    expect(order(items, 'accessed')).toEqual(['b', 'a'])
    expect(order(items, 'accessedAsc')).toEqual(['a', 'b'])
  })

  test('見出しの無いノートは向きに関わらず末尾', () => {
    const items = [
      item({ itemId: 'a', title: '' }),
      item({ itemId: 'b', title: 'B' }),
      item({ itemId: 'c', title: 'C' }),
    ]
    expect(order(items, 'title')).toEqual(['b', 'c', 'a'])
    expect(order(items, 'titleDesc')).toEqual(['c', 'b', 'a'])
  })

  // 同着で並びが揺れると、開き直すたびに一覧の順が変わって前後ナビが迷子になる
  // (docs/15 §2-2)。どの並びも最後は itemId で決着させる
  test('どの並びでも同着は itemId の昇順で決着する', () => {
    const items = [item({ itemId: 'c' }), item({ itemId: 'a' }), item({ itemId: 'b' })]
    // 登録順 (逆順) は id そのものが並べる鍵なので、逆順だけは向きが裏返る
    for (const sort of SORTS) {
      expect(order(items, sort)).toEqual(
        sort === 'registeredDesc' ? ['c', 'b', 'a'] : ['a', 'b', 'c'],
      )
    }
  })

  test('元の配列を書き換えない (immutable)', () => {
    // Arrange
    const items = [item({ itemId: 'b' }), item({ itemId: 'a' })]

    // Act
    const sorted = sortOfflineItems(items, 'updated')

    // Assert
    expect(items.map((i) => i.itemId)).toEqual(['b', 'a'])
    expect(sorted.map((i) => i.itemId)).toEqual(['a', 'b'])
  })
})
