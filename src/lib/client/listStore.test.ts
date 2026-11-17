import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ItemDto } from '@/lib/api/itemDto'
import { listCache, loadMore, retryLoadMore, trashCache, type ListKey } from './listStore'
import { noteCache } from './noteStore'

// 一覧の控え (docs/123 §4-2)。1 ページ目で付属情報を受け、続きは足していく。
// 応答の形を信用しないことと、足すときの重複落としを固定する

const KEY: ListKey = { query: '抵抗', sort: 'updated', view: 'compact' }

function dto(n: number): ItemDto {
  const at = `2026-10-0${(n % 9) + 1}T00:00:00.000Z`
  return {
    itemId: `019a0000-0000-7000-8000-00000000000${n}`,
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

function page(items: ItemDto[], pageNo: number, extras: unknown) {
  return {
    success: true,
    data: { items, circuitThumbs: {}, extras },
    error: null,
    meta: { total: 3, page: pageNo, pageCount: 2 },
  }
}

let responses: unknown[] = []
let requested: string[] = []

beforeEach(() => {
  responses = []
  requested = []
  listCache.remove(() => true)
  noteCache.remove(() => true)
  trashCache.remove(() => true)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested.push(url)
      return new Response(JSON.stringify(responses.shift()))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listCache', () => {
  test('1 ページ目を引き、一覧のノートを控えにも入れる', async () => {
    // Arrange
    responses.push(page([dto(1), dto(2)], 1, EXTRAS))

    // Act
    const value = await listCache.load(KEY)

    // Assert
    expect(requested[0]).toBe('/api/items?q=%E6%8A%B5%E6%8A%97&sort=updated&view=compact&page=1')
    expect(value.items.map((item) => item.title)).toEqual(['ノート 1', 'ノート 2'])
    expect(value.items[0].updatedAt).toBeInstanceOf(Date)
    expect(value).toMatchObject({ total: 3, page: 1, pageCount: 2, extras: EXTRAS })
    expect(noteCache.peek(dto(1).itemId)?.value?.item?.title).toBe('ノート 1')
  })

  test('形の違う応答は受け取らない', async () => {
    // Arrange
    responses.push({ success: true, data: { items: [{ itemId: 1 }], circuitThumbs: {} }, meta: {} })

    // Act / Assert
    await expect(listCache.load(KEY)).rejects.toThrow('検索結果の形が違います')
  })

  test('1 ページ目に付属情報が無ければ受け取らない', async () => {
    // Arrange
    responses.push(page([dto(1)], 1, null))

    // Act / Assert
    await expect(listCache.load(KEY)).rejects.toThrow('検索結果の形が違います')
  })
})

describe('loadMore', () => {
  test('次の 20 件を足し、もう出ているノートは落とす', async () => {
    // Arrange
    responses.push(page([dto(1), dto(2)], 1, EXTRAS))
    await listCache.load(KEY)
    responses.push(page([dto(2), dto(3)], 2, null))

    // Act
    await loadMore(KEY)

    // Assert
    expect(requested[1]).toContain('page=2')
    const value = listCache.peek(KEY)?.value
    expect(value?.items.map((item) => item.title)).toEqual(['ノート 1', 'ノート 2', 'ノート 3'])
    expect(value?.page).toBe(2)
    // 付属情報は 1 ページ目のまま
    expect(value?.extras).toEqual(EXTRAS)
  })

  test('最後のページまで出ていれば何もしない', async () => {
    // Arrange
    responses.push({ ...page([dto(1)], 1, EXTRAS), meta: { total: 1, page: 1, pageCount: 1 } })
    await listCache.load(KEY)

    // Act
    await loadMore(KEY)

    // Assert
    expect(requested).toHaveLength(1)
  })

  test('続きを待つ間に一覧が引き直されたら、古い続きは足さない', async () => {
    // Arrange
    responses.push(page([dto(1)], 1, EXTRAS))
    await listCache.load(KEY)
    responses.push(page([dto(3)], 2, null))

    // Act
    const more = loadMore(KEY)
    listCache.set(KEY, { ...listCache.peek(KEY)!.value!, page: 5 })
    await more

    // Assert
    expect(listCache.peek(KEY)?.value?.items.map((item) => item.title)).toEqual(['ノート 1'])
  })
})

describe('loadMore の失敗と競合', () => {
  test('続きを読めなければ止まり、「もう一度」で読み直す', async () => {
    // Arrange
    responses.push(page([dto(1)], 1, EXTRAS))
    await listCache.load(KEY)
    responses.push({ success: false, data: null, error: '圏外' })

    // Act
    await expect(loadMore(KEY)).rejects.toThrow('圏外')
    await loadMore(KEY)
    responses.push(page([dto(2)], 2, null))
    await retryLoadMore(KEY)

    // Assert: 失敗の後の loadMore は撃たず、retry だけが撃つ
    expect(requested).toHaveLength(3)
    expect(listCache.peek(KEY)?.value?.items).toHaveLength(2)
  })

  test('一覧が古い (取り直し待ち) 間は続きを足さない', async () => {
    // Arrange
    responses.push(page([dto(1)], 1, EXTRAS))
    await listCache.load(KEY)
    listCache.invalidate()

    // Act
    await loadMore(KEY)

    // Assert
    expect(requested).toHaveLength(1)
  })

  test('取り直しの間に頼まれた続きは、取り直しが済んでから読む', async () => {
    // Arrange: 開いた直後の同期で一覧が古くなり、取り直しが走っている
    responses.push(page([dto(1)], 1, EXTRAS))
    await listCache.load(KEY)
    listCache.invalidate()
    responses.push(page([dto(1)], 1, EXTRAS))
    const reload = listCache.load(KEY)

    // Act: その間に画像ビューアの → が続きを頼む
    await loadMore(KEY)
    responses.push(page([dto(2)], 2, null))
    await reload
    await vi.waitFor(() => expect(requested).toHaveLength(3))
    await vi.waitFor(() => expect(listCache.peek(KEY)?.value?.page).toBe(2))

    // Assert: 頼みは捨てられず、取り直しの後に 2 ページ目を足した
    expect(requested[2]).toContain('page=2')
    expect(listCache.peek(KEY)?.value?.items.map((item) => item.title)).toEqual(['ノート 1', 'ノート 2'])
  })

  test('最初の読み込みの間 (値がまだ無い) に頼まれた続きは、届いてから読む', async () => {
    // Arrange: 表示モードを切り替えた直後。新しい鍵の 1 ページ目を取りに行っている
    responses.push(page([dto(1)], 1, EXTRAS))
    const first = listCache.load(KEY)

    // Act: 前の表示の一覧が画面に収まっていて、番兵が続きを頼む (docs/118 §2-6)
    await loadMore(KEY)
    responses.push(page([dto(2)], 2, null))
    await first

    // Assert
    await vi.waitFor(() => expect(listCache.peek(KEY)?.value?.page).toBe(2))
    expect(requested[1]).toContain('page=2')
  })

  test('まだ取りに行っていない鍵への頼みは、取りに行って届いてから読む', async () => {
    // Arrange: 新しい鍵の一覧は描画の後に取りに行く (useEntry の afterPaint)
    responses.push(page([dto(1)], 1, EXTRAS), page([dto(2)], 2, null))

    // Act
    await loadMore(KEY)
    await listCache.load(KEY)

    // Assert
    await vi.waitFor(() => expect(listCache.peek(KEY)?.value?.page).toBe(2))
    expect(requested).toHaveLength(2)
  })

  test('取り直しを待つ間に一覧の控えが消えたら、頼んだ続きは捨てる', async () => {
    // Arrange
    responses.push(page([dto(1)], 1, EXTRAS))
    await listCache.load(KEY)
    listCache.invalidate()

    // Act
    await loadMore(KEY)
    listCache.remove(() => true)
    responses.push(page([dto(1)], 1, EXTRAS))
    await listCache.load(KEY)

    // Assert: 控えが入れ替わった後に古い頼みで 2 ページ目を引かない
    expect(requested).toHaveLength(2)
  })

  test('取り直しは読み進めたページまでを 1 回で引く', async () => {
    // Arrange
    responses.push(page([dto(1)], 1, EXTRAS))
    await listCache.load(KEY)
    responses.push(page([dto(2)], 2, null))
    await loadMore(KEY)
    responses.push({ ...page([dto(1), dto(2)], 2, EXTRAS) })

    // Act
    listCache.invalidate()
    await listCache.load(KEY)

    // Assert
    expect(requested[2]).toContain('page=1&through=2')
    expect(listCache.peek(KEY)?.value?.items).toHaveLength(2)
  })
})

describe('trashCache', () => {
  test('並び順と表示モードを付けてゴミ箱を引く', async () => {
    // Arrange
    responses.push({ success: true, data: { items: [dto(4)], circuitThumbs: {} }, error: null })

    // Act
    const value = await trashCache.load({ sort: 'deleted', view: 'card' })

    // Assert
    expect(requested[0]).toBe('/api/trash?sort=deleted&view=card')
    expect(value.items[0].title).toBe('ノート 4')
  })
})
