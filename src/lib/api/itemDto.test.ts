import { describe, expect, test } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { isItemDto, reviveItem, toItemDto } from './itemDto'

// ノートを API で運ぶ形 (docs/123 §1-2)。Item → JSON → Item で元に戻ることと、
// 外から来た値の形を検めることを固定する

const ITEM: Item = {
  itemId: '019a0000-0000-7000-8000-000000000001',
  memo: '# 抵抗\n#部品',
  title: '抵抗',
  tags: ['部品'],
  props: [{ key: 'R', value: '1k' }],
  taskTodo: 1,
  taskDone: 2,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.123Z'),
  accessedAt: new Date('2026-10-03T00:00:00.000Z'),
  deletedAt: null,
  publicAt: new Date('2026-10-04T00:00:00.000Z'),
  offlinePin: true,
}

describe('itemDto', () => {
  test('JSON を通しても Item に戻る (ミリ秒まで)', () => {
    // Act
    const dto = JSON.parse(JSON.stringify(toItemDto(ITEM))) as unknown

    // Assert
    expect(isItemDto(dto)).toBe(true)
    expect(reviveItem(dto as ReturnType<typeof toItemDto>)).toEqual(ITEM)
  })

  test.each([
    ['null', null],
    ['id が空', { ...toItemDto(ITEM), itemId: '' }],
    ['タグが文字列でない', { ...toItemDto(ITEM), tags: [1] }],
    ['日時が読めない', { ...toItemDto(ITEM), updatedAt: 'きのう' }],
    ['件数が負', { ...toItemDto(ITEM), taskTodo: -1 }],
    ['印が真偽でない', { ...toItemDto(ITEM), offlinePin: 'yes' }],
  ])('形が違えば受け取らない: %s', (_label, value) => {
    // Act / Assert
    expect(isItemDto(value)).toBe(false)
  })
})
