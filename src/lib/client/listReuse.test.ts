import { describe, expect, test } from 'vitest'
import type { ItemDto } from '@/lib/api/itemDto'
import { reviveItem } from '@/lib/api/itemDto'
import { hashText, itemHash, dtoHash, reviveReusing } from './listReuse'

// ノートごとのハッシュで、変わっていないノートを使い回す (docs/129 §2)

function dto(memo: string): ItemDto {
  const at = '2026-10-01T00:00:00.000Z'
  return {
    itemId: '019a0000-0000-7000-8000-000000000001',
    memo,
    title: memo,
    tags: [],
    props: [],
    taskTodo: 0,
    taskDone: 0,
    createdAt: at,
    updatedAt: at,
    accessedAt: at,
    deletedAt: null,
    publicAt: null,
    offlinePin: false,
    eventStart: null,
    eventEnd: null,
    eventRepeat: null,
  }
}

describe('listReuse', () => {
  test('同じ文字列は同じハッシュ、1 文字違えば違うハッシュ', () => {
    expect(hashText('抵抗')).toBe(hashText('抵抗'))
    expect(hashText('抵抗')).not.toBe(hashText('抗抵'))
  })

  test('Item に戻しても DTO と同じハッシュになる', () => {
    expect(itemHash(reviveItem(dto('a')))).toBe(dtoHash(dto('a')))
  })

  test('同じなら前の Item を使い、違えば作り直す', () => {
    // Arrange
    const old = reviveItem(dto('a'))

    // Act
    const [same] = reviveReusing([dto('a')], [old])
    const [changed] = reviveReusing([{ ...dto('a'), offlinePin: true }], [old])

    // Assert
    expect(same).toBe(old)
    expect(changed).not.toBe(old)
    expect(changed.offlinePin).toBe(true)
  })
})
