import { beforeEach, describe, expect, test } from 'vitest'
import type { ItemDto } from '@/lib/api/itemDto'
import { everythingChanged, noteWritten, notesWritten, snapshotChanged } from './invalidate'
import { foldersCache, listCache, tagsCache, trashCache, type ListKey } from './listStore'
import { circuitsCache, neighborsCache, noteCache, renderCache } from './noteStore'

// 書き込みの後にどの控えを古くするか (docs/123 §3-3 の表)

const A = 'a-id'
const B = 'b-id'
const KEY: ListKey = { query: '', sort: 'updated', view: 'compact' }

const DTO: ItemDto = {
  itemId: A,
  memo: '書いた本文',
  title: '書いた本文',
  tags: [],
  props: [],
  taskTodo: 0,
  taskDone: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  accessedAt: '2026-10-02T00:00:00.000Z',
  deletedAt: null,
  publicAt: null,
  offlinePin: false,
}

function seed(): void {
  for (const id of [A, B]) {
    noteCache.set(id, { item: null })
    renderCache.set({ itemId: id, full: true }, { matrices: new Map(), health: new Map(), attachmentBytes: 0 })
    circuitsCache.set(id, new Map())
  }
  listCache.set(KEY, {
    items: [],
    total: 0,
    page: 1,
    pageCount: 1,
    circuitThumbs: {},
    extras: { props: { rows: [], omitted: 0 }, progress: { done: 0, total: 0 }, trashCount: 0, trashedMatches: 0, registerHref: null },
  })
  trashCache.set({ sort: 'deleted', view: 'compact' }, { items: [], circuitThumbs: {} })
  neighborsCache.set({ itemId: A, query: 'q', sort: 'updated' }, { prev: null, next: null })
  tagsCache.set('all', [])
  foldersCache.set('all', { tags: [], hiddenTags: 0, totals: { total: 0, untagged: 0 }, trashCount: 0, saved: [] })
}

beforeEach(seed)

describe('invalidate', () => {
  test('1 件書いたら、そのノートは応答で差し替え、他のノートの本文は触らない', () => {
    // Act
    noteWritten(A, DTO)

    // Assert
    expect(noteCache.peek(A)?.value?.item?.memo).toBe('書いた本文')
    expect(noteCache.peek(B)?.stale).toBe(false)
    expect(circuitsCache.peek(A)?.stale).toBe(true)
    expect(circuitsCache.peek(B)?.stale).toBe(false)
    // 表・グラフは他のノートを数えているかもしれないので全部古くする
    expect(renderCache.peek({ itemId: B, full: true })?.stale).toBe(true)
    for (const entry of [
      listCache.peek(KEY),
      trashCache.peek({ sort: 'deleted', view: 'compact' }),
      neighborsCache.peek({ itemId: A, query: 'q', sort: 'updated' }),
      tagsCache.peek('all'),
      foldersCache.peek('all'),
    ]) {
      expect(entry?.stale).toBe(true)
    }
  })

  test('応答にノートが無ければ古い印だけ付ける', () => {
    // Act
    noteWritten(A)

    // Assert
    expect(noteCache.peek(A)?.stale).toBe(true)
  })

  test('まとめて書いたら選んだノートだけ古くする', () => {
    // Act
    notesWritten([B])

    // Assert
    expect(noteCache.peek(A)?.stale).toBe(false)
    expect(noteCache.peek(B)?.stale).toBe(true)
    expect(listCache.peek(KEY)?.stale).toBe(true)
  })

  test('同期で全件が入れ替わったら全部古くする', () => {
    // Act
    everythingChanged()

    // Assert
    expect(noteCache.peek(A)?.stale).toBe(true)
    expect(circuitsCache.peek(B)?.stale).toBe(true)
    expect(foldersCache.peek('all')?.stale).toBe(true)
  })
})

describe('snapshotChanged', () => {
  test('写しと版が違うノートだけを古くし、一覧は古くする', () => {
    // Arrange
    noteWritten(A, DTO)
    noteCache.set(B, { item: null })
    const same = new Map([[A, DTO.updatedAt]])

    // Act
    snapshotChanged(same)

    // Assert: A は写しと同じ版、B は未登録のまま写しにも無い
    expect(noteCache.peek(A)?.stale).toBe(false)
    expect(noteCache.peek(B)?.stale).toBe(false)
    expect(listCache.peek(KEY)?.stale).toBe(true)
  })

  test('版が違えば古くする', () => {
    // Arrange
    noteWritten(A, DTO)

    // Act
    snapshotChanged(new Map([[A, '2026-10-05T00:00:00.000Z']]))

    // Assert
    expect(noteCache.peek(A)?.stale).toBe(true)
  })
})
