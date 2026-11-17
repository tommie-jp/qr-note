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
import { apiGet, apiGetIfChanged } from './api'
import { waitForListHydration } from './listHydration'
import { reviveReusing, sameElements, sameJson } from './listReuse'
import { MAX_RANGE_PAGES } from '@/lib/api/searchParams'
import { primeNotes } from './noteStore'
import { useSyncExternalStore } from 'react'
import { createNotifier } from '@/lib/prefs/externalStore'
import { createResourceCache, type ResourceCache } from './resourceCache'

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
  // 1〜etagThrough ページをまとめて引いた応答の ETag (docs/129 §2)。続きを
  // 足すと page が進んで合わなくなるので、取り直しは同じ範囲のときだけ添える
  etag: string | null
  etagThrough: number
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
  etag: string | null
}

export function isThumbMap(value: unknown): value is CircuitThumbMap {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(
      (svgs) => Array.isArray(svgs) && svgs.every((svg) => typeof svg === 'string'),
    )
  )
}

export function isMeta(value: unknown): value is { total: number; page: number; pageCount: number } {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return [v.total, v.page, v.pageCount].every((n) => typeof n === 'number' && Number.isInteger(n))
}

function pagePath(key: ListKey, page: number, through: number): string {
  const params = new URLSearchParams({
    q: key.query,
    sort: key.sort,
    view: key.view,
    page: String(page),
  })
  if (through > page) {
    params.set('through', String(through))
  }
  return `/api/items?${params}`
}

// page〜through ページを引く。etag を渡して 304 が返れば null
async function fetchPage(
  key: ListKey,
  page: number,
  through = page,
  etag: string | null = null,
): Promise<PageResponse | null> {
  const res = await apiGetIfChanged<Record<string, unknown>>(pagePath(key, page, through), etag)
  if (res.notModified) {
    return null
  }
  const { items, circuitThumbs, extras } = (res.data ?? {}) as Record<string, unknown>
  if (!Array.isArray(items) || !items.every(isItemDto) || !isThumbMap(circuitThumbs) || !isMeta(res.meta)) {
    throw new Error('検索結果の形が違います')
  }
  primeNotes(items)
  return {
    items,
    circuitThumbs,
    extras: (extras ?? null) as SearchExtras | null,
    ...res.meta,
    etag: res.etag,
  }
}

// 取り直した 1〜N ページを値にする。変わっていないノートは前の物を使い回し、
// 何も変わっていなければ前の値の中身をそのまま渡す (docs/129 §2)
function toListValue(first: PageResponse, extras: SearchExtras, previous: ListValue | undefined): ListValue {
  const items = reviveReusing(first.items, previous?.items)
  const value: ListValue = {
    items,
    total: first.total,
    page: first.page,
    pageCount: first.pageCount,
    circuitThumbs: first.circuitThumbs,
    extras,
    etag: first.etag,
    etagThrough: first.page,
  }
  if (previous === undefined) {
    return value
  }
  return {
    ...value,
    items: sameElements(items, previous.items) ? previous.items : items,
    circuitThumbs: sameJson(first.circuitThumbs, previous.circuitThumbs) ? previous.circuitThumbs : first.circuitThumbs,
    extras: sameJson(extras, previous.extras) ? previous.extras : extras,
  }
}

export const listCache: ResourceCache<ListKey, ListValue> = createResourceCache<ListKey, ListValue>({
  keyOf: listKeyOf,
  maxEntries: 30,
  async fetch(key): Promise<ListValue> {
    // 端末に残した控えを読み終えるのを少しだけ待つ。入っていれば ETag を添えられる
    await waitForListHydration()
    // 読み進めた所まで 1 回で引き直す。書き込みの後の取り直しで一覧が
    // 1 ページ目に縮むと、スクロールの位置も見ていた行も失う
    const previous: ListValue | undefined = listCache.peek(key)?.value
    const through = previous?.page ?? 1
    const etag = previous !== undefined && previous.etagThrough === through ? previous.etag : null
    const first = await fetchPage(key, 1, through, etag)
    if (first === null) {
      // 304 … 前と同じ。値ごと使い回すので画面は描き直さない
      return previous as ListValue
    }
    if (first.extras === null) {
      throw new Error('検索結果の形が違います')
    }
    return toListValue(first, first.extras, listCache.peek(key)?.value ?? previous)
  },
})

// 次の 20 件を足す。読み込み中に検索が変わって控えが捨てられていたら何もしない
const loadingMore = new Map<string, Promise<void>>()
// 続きを読めなかった検索。番兵が見え続けて撃ち直しが止まらなくなるので、
// 失敗したら利用者が押すまで止める
const loadMoreFailed = new Set<string>()
const loadingMoreNotifier = createNotifier()
// 読みたいと頼まれた最後のページ (鍵ごと)。読み込み中に枠が画面に入って
// 先のページを頼まれたら、ここを伸ばし、今の読み込みが済んだら続けて読む
const wantedThrough = new Map<string, number>()

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

// 取り直しを待っている続きの頼み (鍵ごとに 1 つ)。
//
// 一覧は開いた直後の同期などで古くなって取り直す。その間に来た頼み
// (AutoLoadMore の番兵・画像ビューアの →) を捨てると、番兵は見えたままで
// 撃ち直さず、ビューアも次に押されるまで頼まないので、一覧が伸びないまま
// 止まっていた。取り直しが済んだら改めて読む。控えが消えた (検索が替わった)
// ときは捨てる — 新しい控えに古い頼みで続きを足さない。
//
// **まだ値の無い鍵への頼みも待つ** (docs/118 §2-6)。表示モードを切り替えた
// 直後は前の表示の一覧を出したまま、新しい鍵の 1 ページ目を描画の後に取りに
// 行く。その間に番兵が撃った頼みを捨てると、届いても一覧の大きさは変わらず
// 番兵も撃ち直さないので、「さらに表示」を押すまで止まっていた。頼んだ時点で
// 控えが無ければ、控えができて届くまで待つ (一度できた控えが消えたら捨てる)
const deferredMore = new Set<string>()

function deferLoadMore(key: ListKey): void {
  const id = listKeyOf(key)
  if (deferredMore.has(id)) {
    return
  }
  deferredMore.add(id)
  let seen = listCache.peek(key) !== undefined
  const unsubscribe = listCache.subscribe(() => {
    const entry = listCache.peek(key)
    if (entry === undefined && !seen) {
      return
    }
    seen = true
    if (entry !== undefined && (entry.stale || entry.loading)) {
      return
    }
    unsubscribe()
    deferredMore.delete(id)
    if (entry?.value === undefined) {
      return
    }
    // 少なくとも次のページ。値の無いうちに頼まれた「続き」は、届いた値の次になる
    void loadThrough(key, Math.max(wantedThrough.get(id) ?? 0, entry.value.page + 1)).catch((error: unknown) =>
      console.warn('続きを読めませんでした', error),
    )
  })
}

// 届いた続きのページを一覧に足す。fromPage … 頼んだ時点で読み終えていたページ。
//
// 待つ間に書き込みで古くなった (取り直しが走っている) なら足さない。
// ここで set すると取り直しを打ち消し、古い一覧を新しいことにしてしまう
function appendPage(key: ListKey, fromPage: number, next: PageResponse): void {
  const latestEntry = listCache.peek(key)
  const latest = latestEntry?.value
  if (latest === undefined || latest.page !== fromPage || latestEntry?.stale || latestEntry?.loading) {
    return
  }
  const seen = new Set(latest.items.map((item) => item.itemId))
  listCache.set(key, {
    ...latest,
    items: [...latest.items, ...reviveReusing(next.items.filter((dto) => !seen.has(dto.itemId)), undefined)],
    total: next.total,
    page: next.page,
    pageCount: next.pageCount,
    circuitThumbs: { ...latest.circuitThumbs, ...next.circuitThumbs },
  })
}

// 次の 20 件を足す
export function loadMore(key: ListKey): Promise<void> {
  // 値がまだ無ければ 0 (= 届いた値の次。deferLoadMore が決める)
  const page = listCache.peek(key)?.value?.page
  return loadThrough(key, page === undefined ? 0 : page + 1)
}

// target ページまでを足す (docs/129 §1)。読み終えた次のページから target までを
// 1 回で引く (幅は MAX_RANGE_PAGES まで。残りは続けて読む)
export function loadThrough(key: ListKey, target: number): Promise<void> {
  const id = listKeyOf(key)
  wantedThrough.set(id, Math.max(wantedThrough.get(id) ?? 0, target))
  const running = loadingMore.get(id)
  if (running) {
    return running
  }
  const currentEntry = listCache.peek(key)
  if (loadMoreFailed.has(id) || (currentEntry?.error && currentEntry.value === undefined)) {
    return Promise.resolve()
  }
  if (currentEntry === undefined || currentEntry.stale || currentEntry.loading) {
    // 取り直しの最中に足すと打ち消し合う (appendPage の注) ので、いまは読まない。
    // ただし頼みは捨てずに、取り直し (値の無い鍵なら最初の読み込み) が済んで
    // から読む (deferLoadMore)
    deferLoadMore(key)
    return Promise.resolve()
  }
  const current = currentEntry.value
  const want = wantedThrough.get(id) ?? target
  if (current === undefined || current.page >= Math.min(want, current.pageCount)) {
    wantedThrough.delete(id)
    return Promise.resolve()
  }
  const last = Math.min(want, current.pageCount, current.page + MAX_RANGE_PAGES)
  return startLoad(key, id, current.page, last)
}

function startLoad(key: ListKey, id: string, fromPage: number, last: number): Promise<void> {
  const promise = fetchPage(key, fromPage + 1, last)
    .then((next) => {
      if (next !== null) {
        appendPage(key, fromPage, next)
      }
    })
    .catch((error: unknown) => {
      loadMoreFailed.add(id)
      wantedThrough.delete(id)
      throw error
    })
    .finally(() => {
      loadingMore.delete(id)
      loadingMoreNotifier.notify()
      continueWanted(key, id)
    })
  loadingMore.set(id, promise)
  loadingMoreNotifier.notify()
  return promise
}

// 読み込みの間に先のページを頼まれていたら、続けて読む
function continueWanted(key: ListKey, id: string): void {
  const want = wantedThrough.get(id)
  if (want === undefined || loadMoreFailed.has(id)) {
    return
  }
  void loadThrough(key, want).catch((error: unknown) => console.warn('続きを読めませんでした', error))
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
