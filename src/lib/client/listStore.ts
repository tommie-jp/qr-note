// 端末側の一覧の控え (docs/123 §3-2・§4-2)。
//
// 鍵は 検索語・並び順・表示モード。表示モードを鍵に入れるのは、回路図サムネの
// 引き方 (画像表示は全部、それ以外は先頭 1 枚) がモードで違うため。
//
// ページは足していく (AutoLoadMore が次の 20 件を足す)。サーバ描画の頃の
// 「1〜N ページを毎回描き直す」はここで無くなる (docs/118 §2-3 の段階 B)
import 'client-only'
import type { Item } from '@/generated/prisma/client'
import { isItemDto, reviveItem, type ItemDto } from '@/lib/api/itemDto'
import type { SearchExtras } from '@/lib/api/searchPayload'
import type { CircuitThumbMap } from '@/lib/circuit/types'
import type { FolderTotals, TagCount } from '@/lib/items/read'
import type { ViewMode } from '@/lib/prefs/viewMode'
import type { Sort } from '@/lib/validation'
import { apiGet } from './api'
import { primeNotes } from './noteStore'
import { useSyncExternalStore } from 'react'
import { createNotifier } from '@/lib/prefs/externalStore'
import { createResourceCache } from './resourceCache'

export interface ListKey {
  query: string
  sort: Sort
  view: ViewMode
}

export interface ListValue {
  items: Item[]
  total: number
  page: number
  pageCount: number
  circuitThumbs: CircuitThumbMap
  extras: SearchExtras
}

export function listKeyOf({ query, sort, view }: ListKey): string {
  return `${query}\u0000${sort}\u0000${view}`
}

interface PageResponse {
  items: ItemDto[]
  circuitThumbs: CircuitThumbMap
  extras: SearchExtras | null
  total: number
  page: number
  pageCount: number
}

function isThumbMap(value: unknown): value is CircuitThumbMap {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(
      (svgs) => Array.isArray(svgs) && svgs.every((svg) => typeof svg === 'string'),
    )
  )
}

function isMeta(value: unknown): value is { total: number; page: number; pageCount: number } {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return [v.total, v.page, v.pageCount].every((n) => typeof n === 'number' && Number.isInteger(n))
}

async function fetchPage(key: ListKey, page: number, through = 1): Promise<PageResponse> {
  const params = new URLSearchParams({
    q: key.query,
    sort: key.sort,
    view: key.view,
    page: String(page),
  })
  if (through > 1) {
    params.set('through', String(through))
  }
  const { data, meta } = await apiGet<Record<string, unknown>>(`/api/items?${params}`)
  const { items, circuitThumbs, extras } = (data ?? {}) as Record<string, unknown>
  if (!Array.isArray(items) || !items.every(isItemDto) || !isThumbMap(circuitThumbs) || !isMeta(meta)) {
    throw new Error('検索結果の形が違います')
  }
  primeNotes(items)
  return {
    items,
    circuitThumbs,
    extras: (extras ?? null) as SearchExtras | null,
    ...meta,
  }
}

export const listCache = createResourceCache<ListKey, ListValue>({
  keyOf: listKeyOf,
  maxEntries: 30,
  async fetch(key) {
    // 読み進めた所まで 1 回で引き直す。書き込みの後の取り直しで一覧が
    // 1 ページ目に縮むと、スクロールの位置も見ていた行も失う
    const through = listCache.peek(key)?.value?.page ?? 1
    const first = await fetchPage(key, 1, through)
    if (first.extras === null) {
      throw new Error('検索結果の形が違います')
    }
    return {
      items: first.items.map(reviveItem),
      total: first.total,
      page: first.page,
      pageCount: first.pageCount,
      circuitThumbs: first.circuitThumbs,
      extras: first.extras,
    }
  },
})

// 次の 20 件を足す。読み込み中に検索が変わって控えが捨てられていたら何もしない
const loadingMore = new Map<string, Promise<void>>()
// 続きを読めなかった検索。番兵が見え続けて撃ち直しが止まらなくなるので、
// 失敗したら利用者が押すまで止める
const loadMoreFailed = new Set<string>()
const loadingMoreNotifier = createNotifier()

export function useLoadMoreFailed(key: ListKey): boolean {
  const id = listKeyOf(key)
  return useSyncExternalStore(
    loadingMoreNotifier.subscribe,
    () => loadMoreFailed.has(id),
    () => false,
  )
}

// 「もう一度」で失敗の印を消す
export function retryLoadMore(key: ListKey): Promise<void> {
  loadMoreFailed.delete(listKeyOf(key))
  loadingMoreNotifier.notify()
  return loadMore(key)
}

// 続きを読んでいる最中か (「さらに表示」を読み込み中にする)
export function useLoadingMore(key: ListKey): boolean {
  const id = listKeyOf(key)
  return useSyncExternalStore(
    loadingMoreNotifier.subscribe,
    () => loadingMore.has(id),
    () => false,
  )
}

export function loadMore(key: ListKey): Promise<void> {
  const id = listKeyOf(key)
  const running = loadingMore.get(id)
  if (running) {
    return running
  }
  const currentEntry = listCache.peek(key)
  const current = currentEntry?.value
  if (
    current === undefined ||
    current.page >= current.pageCount ||
    loadMoreFailed.has(id) ||
    currentEntry?.stale ||
    currentEntry?.loading
  ) {
    return Promise.resolve()
  }
  const promise = fetchPage(key, current.page + 1)
    .then((next) => {
      // 待つ間に書き込みで古くなった (取り直しが走っている) なら足さない。
      // ここで set すると取り直しを打ち消し、古い一覧を新しいことにしてしまう
      const latestEntry = listCache.peek(key)
      const latest = latestEntry?.value
      if (
        latest === undefined ||
        latest.page !== current.page ||
        latestEntry?.stale ||
        latestEntry?.loading
      ) {
        return
      }
      const seen = new Set(latest.items.map((item) => item.itemId))
      listCache.set(key, {
        ...latest,
        items: [...latest.items, ...next.items.filter((dto) => !seen.has(dto.itemId)).map(reviveItem)],
        total: next.total,
        page: next.page,
        pageCount: next.pageCount,
        circuitThumbs: { ...latest.circuitThumbs, ...next.circuitThumbs },
      })
    })
    .catch((error: unknown) => {
      loadMoreFailed.add(id)
      throw error
    })
    .finally(() => {
      loadingMore.delete(id)
      loadingMoreNotifier.notify()
    })
  loadingMore.set(id, promise)
  loadingMoreNotifier.notify()
  return promise
}

export const tagsCache = createResourceCache<'all', TagCount[]>({
  async fetch() {
    const { data } = await apiGet<{ tags: unknown }>('/api/tags')
    const tags = (data as { tags?: unknown } | null)?.tags
    if (!Array.isArray(tags)) {
      throw new Error('タグの形が違います')
    }
    return tags as TagCount[]
  },
})

export interface FoldersValue {
  tags: TagCount[]
  hiddenTags: number
  totals: FolderTotals
  trashCount: number
  saved: string[]
}

export const foldersCache = createResourceCache<'all', FoldersValue>({
  async fetch() {
    const { data } = await apiGet<FoldersValue>('/api/folders')
    if (
      typeof data !== 'object' ||
      data === null ||
      !Array.isArray(data.tags) ||
      !Array.isArray(data.saved) ||
      typeof data.trashCount !== 'number'
    ) {
      throw new Error('フォルダーの形が違います')
    }
    return data
  },
})

export interface TrashKey {
  sort: string
  view: ViewMode
}

export interface TrashValue {
  items: Item[]
  circuitThumbs: CircuitThumbMap
}

export const trashCache = createResourceCache<TrashKey, TrashValue>({
  keyOf: ({ sort, view }) => `${sort}\u0000${view}`,
  maxEntries: 10,
  async fetch({ sort, view }) {
    const params = new URLSearchParams({ sort, view })
    const { data } = await apiGet<Record<string, unknown>>(`/api/trash?${params}`)
    const { items, circuitThumbs } = (data ?? {}) as Record<string, unknown>
    if (!Array.isArray(items) || !items.every(isItemDto) || !isThumbMap(circuitThumbs)) {
      throw new Error('ゴミ箱の形が違います')
    }
    return { items: items.map(reviveItem), circuitThumbs }
  },
})
