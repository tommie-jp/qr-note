import { beforeEach, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'

// DB と描画は差し替える。確かめたいのは「どの条件で何を引き、派生計算に
// 何を渡すか」の配線であって、SQL や KaTeX ではない。
// 検索式の判定 (search/rewrite) と採番リンク (scanRegister) は純粋なので本物
const mocks = vi.hoisted(() => ({
  searchItems: vi.fn(),
  searchItemProps: vi.fn(),
  countTaskProgress: vi.fn(),
  countTrashedItems: vi.fn(),
  countTrashedMatches: vi.fn(),
  newItemId: vi.fn(),
  loadCircuitThumbs: vi.fn(),
  buildMathTexts: vi.fn(),
  buildMathSummaries: vi.fn(),
  buildNotePreviews: vi.fn(),
}))

vi.mock('@/lib/items/search', () => ({
  searchItems: mocks.searchItems,
  searchItemProps: mocks.searchItemProps,
  countTaskProgress: mocks.countTaskProgress,
}))
vi.mock('@/lib/items/trash', () => ({
  countTrashedItems: mocks.countTrashedItems,
  countTrashedMatches: mocks.countTrashedMatches,
}))
vi.mock('@/lib/items/itemId', () => ({ newItemId: mocks.newItemId }))
vi.mock('@/lib/circuit/thumbs', () => ({
  loadCircuitThumbs: mocks.loadCircuitThumbs,
}))
vi.mock('@/lib/markdown/mathText', () => ({
  buildMathTexts: mocks.buildMathTexts,
  buildMathSummaries: mocks.buildMathSummaries,
}))
vi.mock('@/components/item/NotePreviewThumb', () => ({
  buildNotePreviews: mocks.buildNotePreviews,
}))

const { loadSearchResults } = await import('./pageData')

const ITEMS = [{ itemId: '00000000-0000-7000-8000-000000004951', memo: 'BJT NPN' }] as Item[]
const THUMBS = { '00000000-0000-7000-8000-000000004951': ['<svg/>'] }
const MATH = { '00000000-0000-7000-8000-000000004951': { title: '<span/>' } }
const SUMMARIES = { '00000000-0000-7000-8000-000000004951': '<span/>' }
const PREVIEWS = { '00000000-0000-7000-8000-000000004951': 'preview' }

const searchResult = (total: number) => ({
  items: total === 0 ? [] : ITEMS,
  total,
  page: 1,
  pageCount: 1,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchItems.mockResolvedValue(searchResult(1))
  mocks.searchItemProps.mockResolvedValue({ rows: [{ itemId: '00000000-0000-7000-8000-000000004951' }], omitted: 2 })
  mocks.countTaskProgress.mockResolvedValue({ done: 3, total: 5 })
  mocks.countTrashedItems.mockResolvedValue(0)
  mocks.countTrashedMatches.mockResolvedValue(4)
  mocks.newItemId.mockReturnValue('00000000-0000-7000-8000-000000005000')
  mocks.loadCircuitThumbs.mockResolvedValue(THUMBS)
  mocks.buildMathTexts.mockReturnValue(MATH)
  mocks.buildMathSummaries.mockReturnValue(SUMMARIES)
  mocks.buildNotePreviews.mockReturnValue(PREVIEWS)
})

const load = (overrides: Partial<Parameters<typeof loadSearchResults>[0]> = {}) =>
  loadSearchResults({ query: '', page: '1', sort: 'updated', view: 'compact', ...overrides })

test('素の検索は一覧だけを引き、特性表・進捗・0 件時の 2 つは引かない', async () => {
  // Act
  const data = await load()

  // Assert
  expect(mocks.searchItems).toHaveBeenCalledWith('', 1, 'updated')
  expect(mocks.searchItemProps).not.toHaveBeenCalled()
  expect(mocks.countTaskProgress).not.toHaveBeenCalled()
  expect(mocks.newItemId).not.toHaveBeenCalled()
  expect(mocks.countTrashedMatches).not.toHaveBeenCalled()
  expect(data.props).toEqual({ rows: [], omitted: 0 })
  expect(data.progress).toEqual({ done: 0, total: 0 })
  expect(data.registerHref).toBeNull()
  expect(data.trashedMatches).toBe(0)
})

test('ページ番号は数にして渡し、数でなければ 1 ページ目', async () => {
  // Act
  await load({ page: '3', sort: 'accessed' })
  await load({ page: 'abc' })

  // Assert
  expect(mocks.searchItems).toHaveBeenNthCalledWith(1, '', 3, 'accessed')
  expect(mocks.searchItems).toHaveBeenNthCalledWith(2, '', 1, 'updated')
})

test('タグ検索のときだけ特性表を同じ並びで引く', async () => {
  // Act
  const data = await load({ query: '#npn', sort: 'registered' })

  // Assert
  expect(mocks.searchItemProps).toHaveBeenCalledWith('#npn', 'registered')
  expect(data.props).toEqual({ rows: [{ itemId: '00000000-0000-7000-8000-000000004951' }], omitted: 2 })
})

test('チェック状態で絞っているときだけ進捗を数える', async () => {
  // Act
  const data = await load({ query: '#英単語 is:todo' })

  // Assert
  expect(mocks.countTaskProgress).toHaveBeenCalledWith('#英単語 is:todo')
  expect(data.progress).toEqual({ done: 3, total: 5 })
})

test('0 件でタグにできる語なら採番して新規登録のリンクを作る', async () => {
  // Arrange
  mocks.searchItems.mockResolvedValue(searchResult(0))

  // Act
  const data = await load({ query: '4901234567894' })

  // Assert
  expect(mocks.newItemId).toHaveBeenCalledOnce()
  expect(data.registerHref).toBe('/edit/00000000-0000-7000-8000-000000005000?code=4901234567894')
})

test('0 件でタグ検索の形 (#1250) なら # を剥がしたコードで新規登録のリンクを作る (docs/111 §7)', async () => {
  // Arrange
  mocks.searchItems.mockResolvedValue(searchResult(0))

  // Act
  const data = await load({ query: '#1250' })

  // Assert
  expect(data.registerHref).toBe('/edit/00000000-0000-7000-8000-000000005000?code=1250')
})

test('ヒットした検索では採番しない', async () => {
  // Act
  const data = await load({ query: '4901234567894' })

  // Assert
  expect(mocks.newItemId).not.toHaveBeenCalled()
  expect(data.registerHref).toBeNull()
})

test('0 件でゴミ箱が空でなければ、ゴミ箱の一致を数える', async () => {
  // Arrange
  mocks.searchItems.mockResolvedValue(searchResult(0))
  mocks.countTrashedItems.mockResolvedValue(7)

  // Act
  const data = await load({ query: 'bfp420' })

  // Assert
  expect(mocks.countTrashedMatches).toHaveBeenCalledWith('bfp420')
  expect(data.trashCount).toBe(7)
  expect(data.trashedMatches).toBe(4)
})

test('0 件でもゴミ箱が空なら一致を数えない', async () => {
  // Arrange
  mocks.searchItems.mockResolvedValue(searchResult(0))

  // Act
  const data = await load({ query: 'bfp420' })

  // Assert
  expect(mocks.countTrashedMatches).not.toHaveBeenCalled()
  expect(data.trashedMatches).toBe(0)
})

test('小・中・カードは回路図の先頭 1 枚、画像は全部を引く', async () => {
  // Act
  await load({ view: 'card' })
  await load({ view: 'image' })

  // Assert
  expect(mocks.loadCircuitThumbs).toHaveBeenNthCalledWith(1, ITEMS, 'first')
  expect(mocks.loadCircuitThumbs).toHaveBeenNthCalledWith(2, ITEMS, 'all')
})

test('数式はカードだけプレビューまで作り、特性表の要約にタイトルを使い回す', async () => {
  // Act
  const card = await load({ view: 'card', query: '#npn' })
  await load({ view: 'medium' })

  // Assert
  expect(mocks.buildMathTexts).toHaveBeenNthCalledWith(1, ITEMS, 'both')
  expect(mocks.buildMathTexts).toHaveBeenNthCalledWith(2, ITEMS, 'title')
  expect(mocks.buildMathSummaries).toHaveBeenNthCalledWith(1, [{ itemId: '00000000-0000-7000-8000-000000004951' }], MATH)
  expect(card.mathTexts).toBe(MATH)
  expect(card.mathSummaries).toBe(SUMMARIES)
})

test('本文プレビューは回路図サムネと表示モードを渡して作る', async () => {
  // Act
  const data = await load({ view: 'medium' })

  // Assert
  expect(mocks.buildNotePreviews).toHaveBeenCalledWith(ITEMS, THUMBS, 'medium')
  expect(data.circuitThumbs).toBe(THUMBS)
  expect(data.notePreviews).toBe(PREVIEWS)
  expect(data.result).toEqual(searchResult(1))
})

// 速度計測 (docs/119 §2-1)。切っていれば null、計測中は段階を始めた順に返す
test('計測していなければ perf は null、計測中は段階の時間を返す', async () => {
  const { setPerfLogEnabled } = await import('@/lib/logging/perfSwitch')
  expect((await load()).perf).toBeNull()

  setPerfLogEnabled(true)
  try {
    const { perf } = await load()
    expect(Object.keys(perf?.phases ?? {})).toEqual([
      '検索',
      'ゴミ箱',
      '回路',
      '数式',
      'プレビュー',
    ])
  } finally {
    setPerfLogEnabled(false)
  }
})
