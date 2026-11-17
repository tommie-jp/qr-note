import { describe, expect, test } from 'vitest'
import type { ItemDto } from '@/lib/api/itemDto'
import { reviveItem } from '@/lib/api/itemDto'
import { MAX_SAVED_PAGES, parseSavedList, SAVED_LIST_MAX_AGE_MS, toListValue, toSavedList } from './listPersist'
import type { ListKey, ListValue } from './listStore'

// 端末に残す一覧の控え (docs/129 §3)。読み戻した物は外部入力として検める

const KEY: ListKey = { query: '抵抗', sort: 'updated', view: 'compact' }
const NOW = Date.parse('2026-11-17T00:00:00Z')

function dto(n: number): ItemDto {
  const at = '2026-10-01T00:00:00.000Z'
  return {
    itemId: `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    memo: `# ノート ${n}`,
    title: `ノート ${n}`,
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

const EXTRAS = {
  props: { rows: [], omitted: 0 },
  progress: { done: 0, total: 0 },
  trashCount: 0,
  trashedMatches: 0,
  registerHref: null,
}

function value(count: number, page: number): ListValue {
  return {
    items: Array.from({ length: count }, (_, i) => reviveItem(dto(i + 1))),
    total: 500,
    page,
    pageCount: 25,
    circuitThumbs: { [dto(1).itemId]: ['<svg/>'], [dto(200).itemId]: ['<svg/>'] },
    extras: EXTRAS,
    etag: '"v1"',
    etagThrough: page,
  }
}

describe('toSavedList', () => {
  test('ページ数を切り詰め、切り詰めたら ETag を捨てる', () => {
    // Act
    const saved = toSavedList(KEY, value(200, 10), NOW)

    // Assert
    expect(saved.page).toBe(MAX_SAVED_PAGES)
    expect(saved.items).toHaveLength(MAX_SAVED_PAGES * 20)
    expect(saved.etag).toBeNull()
    expect(Object.keys(saved.circuitThumbs)).toEqual([dto(1).itemId])
  })

  test('そのまま残せるなら ETag も残す', () => {
    expect(toSavedList(KEY, value(20, 1), NOW).etag).toBe('"v1"')
  })
})

describe('parseSavedList', () => {
  test('残した物を読み戻すと同じ一覧になる', () => {
    // Arrange
    const saved = JSON.parse(JSON.stringify(toSavedList(KEY, value(20, 1), NOW - 1000)))

    // Act
    const parsed = parseSavedList(saved, NOW)

    // Assert
    expect(parsed?.key).toEqual(KEY)
    const restored = toListValue(parsed!)
    expect(restored.items[0].updatedAt).toBeInstanceOf(Date)
    expect(restored.etagThrough).toBe(1)
  })

  test.each([
    ['形が違う', { key: KEY }],
    ['鍵の並び順が知らない値', { ...toSavedList(KEY, value(1, 1), NOW), key: { ...KEY, sort: 'random' } }],
    ['ノートの形が違う', { ...toSavedList(KEY, value(1, 1), NOW), items: [{ itemId: 1 }] }],
    ['付属情報が無い', { ...toSavedList(KEY, value(1, 1), NOW), extras: null }],
    ['古すぎる', toSavedList(KEY, value(1, 1), NOW - SAVED_LIST_MAX_AGE_MS - 1)],
    ['未来の時刻', toSavedList(KEY, value(1, 1), NOW + 1000)],
  ])('%s なら読まない', (_label, raw) => {
    expect(parseSavedList(JSON.parse(JSON.stringify(raw)), NOW)).toBeNull()
  })
})
