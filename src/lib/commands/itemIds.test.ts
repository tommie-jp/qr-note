import { describe, expect, test } from 'vitest'
import { parseItemIdList } from './itemIds'

// JSON で受けた id の並び (docs/123 §2-1)。形の悪い id・重複は落とし、
// 配列でなければ null (route が 400 にする)
const ID1 = '00000000-0000-7000-8000-000000000001'
const ID2 = '00000000-0000-7000-8000-000000000002'

function idAt(n: number): string {
  return `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
}

describe('parseItemIdList', () => {
  test('形の悪い id と重複を落とし、順は保つ', () => {
    // Act
    const ids = parseItemIdList([ID2, '../x', ID1, ID2, 42, null, ID1.toUpperCase()])

    // Assert
    expect(ids).toEqual([ID2, ID1])
  })

  test.each([undefined, null, 'id', { 0: ID1 }])('配列でない %s は null', (value) => {
    expect(parseItemIdList(value)).toBeNull()
  })

  test('空の配列は空 (null ではない)', () => {
    expect(parseItemIdList([])).toEqual([])
  })

  test('5000 件で切る', () => {
    const many = Array.from({ length: 5001 }, (_, i) => idAt(i + 1))

    const ids = parseItemIdList(many)

    expect(ids).toHaveLength(5000)
    expect(ids?.at(-1)).toBe(idAt(5000))
  })
})
