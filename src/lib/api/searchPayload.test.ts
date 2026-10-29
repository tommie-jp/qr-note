import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'

// 検索 API の中身 (docs/123 §1-3)。付属情報は 1 ページ目だけ、through で累積、
// 0 件のときだけ新規登録とゴミ箱の一致を引く、を固定する
const mocks = vi.hoisted(() => ({
  searchItems: vi.fn(),
  searchItemsPage: vi.fn(),
  searchItemProps: vi.fn(),
  countTaskProgress: vi.fn(),
  countTrashedItems: vi.fn(),
  countTrashedMatches: vi.fn(),
  loadCircuitThumbs: vi.fn(),
}))

vi.mock('@/lib/items/search', () => ({
  searchItems: mocks.searchItems,
  searchItemsPage: mocks.searchItemsPage,
  searchItemProps: mocks.searchItemProps,
  countTaskProgress: mocks.countTaskProgress,
}))
vi.mock('@/lib/items/trash', () => ({
  countTrashedItems: mocks.countTrashedItems,
  countTrashedMatches: mocks.countTrashedMatches,
}))
vi.mock('@/lib/circuit/thumbs', () => ({ loadCircuitThumbs: mocks.loadCircuitThumbs }))
vi.mock('@/lib/items/itemId', () => ({ newItemId: () => '019a0000-0000-7000-8000-0000000000ff' }))

const { loadSearchPayload } = await import('./searchPayload')

const ITEM = {
  itemId: '019a0000-0000-7000-8000-000000000001',
  memo: 'm',
  title: 't',
  tags: [],
  props: [],
  taskTodo: 0,
  taskDone: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  accessedAt: new Date(0),
  deletedAt: null,
  publicAt: null,
  offlinePin: false,
} satisfies Item

beforeEach(() => {
  vi.resetAllMocks()
  mocks.searchItemsPage.mockResolvedValue({ items: [ITEM], total: 1, page: 1, pageCount: 1 })
  mocks.searchItems.mockResolvedValue({ items: [ITEM], total: 41, page: 3, pageCount: 3 })
  mocks.searchItemProps.mockResolvedValue({ rows: [{ itemId: ITEM.itemId }], omitted: 0 })
  mocks.countTaskProgress.mockResolvedValue({ done: 1, total: 2 })
  mocks.countTrashedItems.mockResolvedValue(4)
  mocks.countTrashedMatches.mockResolvedValue(2)
  mocks.loadCircuitThumbs.mockResolvedValue({ [ITEM.itemId]: ['<svg/>'] })
})

describe('loadSearchPayload', () => {
  test('1 ページ目は付属情報を付け、ノートは DTO にする', async () => {
    // Act
    const { payload, meta } = await loadSearchPayload({ query: '抵抗', page: 1, sort: 'updated', view: 'compact' })

    // Assert
    expect(payload.items[0].createdAt).toBe('1970-01-01T00:00:00.000Z')
    expect(payload.circuitThumbs).toEqual({ [ITEM.itemId]: ['<svg/>'] })
    expect(payload.extras).toMatchObject({ trashCount: 4, trashedMatches: 0, registerHref: null })
    expect(meta).toEqual({ total: 1, page: 1, pageCount: 1 })
    expect(mocks.loadCircuitThumbs).toHaveBeenCalledWith([ITEM], 'first')
    // タグ検索でも進捗の絞りでもないので特性表と進捗は引かない
    expect(mocks.searchItemProps).not.toHaveBeenCalled()
    expect(mocks.countTaskProgress).not.toHaveBeenCalled()
  })

  test('続きのページは付属情報を付けず、ゴミ箱も数えない', async () => {
    // Act
    const { payload } = await loadSearchPayload({ query: '#抵抗', page: 2, sort: 'updated', view: 'image' })

    // Assert
    expect(payload.extras).toBeNull()
    expect(mocks.countTrashedItems).not.toHaveBeenCalled()
    expect(mocks.searchItemProps).not.toHaveBeenCalled()
    expect(mocks.loadCircuitThumbs).toHaveBeenCalledWith([ITEM], 'all')
  })

  test('through は 1〜N ページの累積で引く', async () => {
    // Act
    const { meta } = await loadSearchPayload({ query: '', page: 1, through: 3, sort: 'title', view: 'compact' })

    // Assert
    expect(mocks.searchItems).toHaveBeenCalledWith('', 3, 'title')
    expect(mocks.searchItemsPage).not.toHaveBeenCalled()
    expect(meta.page).toBe(3)
  })

  test('タグ検索は特性表を、チェック状態の検索は進捗を引く', async () => {
    // Act
    const tag = await loadSearchPayload({ query: '#抵抗', page: 1, sort: 'updated', view: 'compact' })
    const todo = await loadSearchPayload({ query: '#英単語 is:todo', page: 1, sort: 'updated', view: 'compact' })

    // Assert
    expect(tag.payload.extras?.props.rows).toHaveLength(1)
    expect(todo.payload.extras?.progress).toEqual({ done: 1, total: 2 })
  })

  test('0 件ならタグにできる語の新規登録の導線と、ゴミ箱の一致を返す', async () => {
    // Arrange
    mocks.searchItemsPage.mockResolvedValue({ items: [], total: 0, page: 1, pageCount: 1 })

    // Act
    const { payload } = await loadSearchPayload({ query: '4901234567894', page: 1, sort: 'updated', view: 'compact' })

    // Assert
    expect(payload.extras?.registerHref).toContain('/edit/019a0000-0000-7000-8000-0000000000ff')
    expect(payload.extras?.trashedMatches).toBe(2)
  })
})
