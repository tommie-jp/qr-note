// 最近の検索一覧の控えを端末 (IndexedDB) に残し、起動直後に読み戻す (docs/129 §3)。
//
// 一覧の控え (listStore の listCache) はメモリにしか無く、再読み込みや PWA の
// 起動のたびに「検索結果を読み込み中…」から始まっていた。直近の数検索ぶんを
// 残しておき、起動直後はそれを出してから裏で取り直す。取り直しは ETag を
// 添えるので、変わっていなければ 304 で本文は運ばれない。
//
// 置く物の種類は増えない: ノートの本文は既にオフラインの写し (snapshotDb.ts) と
// して同じ DB に平文で置いている。消し方も写しに揃える — ログアウトで消す
// (clearOfflineData)・古すぎる物は読まない・デモでは残さない (呼び出し側)。
//
// 読み戻した物は外部入力として検める (古い版のアプリが書いた形がありうる)
import 'client-only'
import type { SearchExtras } from '@/lib/api/searchPayload'
import { isItemDto, reviveItem, toItemDto, type ItemDto } from '@/lib/api/itemDto'
import type { CircuitThumbMap } from '@/lib/circuit/types'
import { PAGE_SIZE } from '@/lib/items/limits'
import { getRecord, putRecord } from '@/lib/offline/idb'
import { parseViewMode } from '@/lib/prefs/viewMode'
import { isSecretSearchedQuery, subscribeSecretSearchedQueries } from '@/lib/secret/searchPrivacy'
import { parseSort } from '@/lib/validation'
import { setListHydration } from './listHydration'
import { isMeta, isThumbMap, listCache, listKeyOf, type ListKey, type ListValue } from './listStore'

export const LISTS_RECORD_KEY = 'recent'
// 残す検索の数と、1 検索あたりのページ数 (5 ページ = 100 件)
export const MAX_SAVED_LISTS = 10
export const MAX_SAVED_PAGES = 5
// これより古い控えは読まない (オフラインの写しと同じ 30 日)
export const SAVED_LIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
// 控えが動いてから書くまで待つ時間。続きの読み込みが続く間は書かない
const SAVE_DELAY_MS = 1500

interface SavedList {
  key: ListKey
  at: number
  items: ItemDto[]
  total: number
  page: number
  pageCount: number
  circuitThumbs: CircuitThumbMap
  extras: SearchExtras
  etag: string | null
}

// 残す形にする。ページ数を切り詰めたら ETag は合わなくなるので捨てる
export function toSavedList(key: ListKey, value: ListValue, at: number): SavedList {
  const page = Math.min(value.page, MAX_SAVED_PAGES)
  const items = value.items.slice(0, page * PAGE_SIZE)
  const ids = new Set(items.map((item) => item.itemId))
  const circuitThumbs = Object.fromEntries(
    Object.entries(value.circuitThumbs).filter(([itemId]) => ids.has(itemId)),
  )
  const whole = page === value.page && value.etagThrough === value.page
  return {
    key,
    at,
    items: items.map(toItemDto),
    total: value.total,
    page,
    pageCount: value.pageCount,
    circuitThumbs,
    extras: value.extras,
    etag: whole ? value.etag : null,
  }
}

function isExtras(value: unknown): value is SearchExtras {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  const props = v.props as Record<string, unknown> | null | undefined
  const progress = v.progress as Record<string, unknown> | null | undefined
  return (
    typeof props === 'object' && props !== null && Array.isArray(props.rows) && typeof props.omitted === 'number' &&
    typeof progress === 'object' && progress !== null && typeof progress.done === 'number' &&
    typeof progress.total === 'number' && typeof v.trashCount === 'number' &&
    typeof v.trashedMatches === 'number' && (v.registerHref === null || typeof v.registerHref === 'string')
  )
}

function parseKey(value: unknown): ListKey | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const v = value as Record<string, unknown>
  if (typeof v.query !== 'string' || parseSort(v.sort) !== v.sort || parseViewMode(v.view) !== v.view) {
    return null
  }
  return { query: v.query, sort: parseSort(v.sort), view: parseViewMode(v.view) }
}

// 読み戻した 1 件を検める。形が違うか古すぎれば null
export function parseSavedList(value: unknown, now: number): SavedList | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const v = value as Record<string, unknown>
  const key = parseKey(v.key)
  const fresh = typeof v.at === 'number' && v.at <= now && now - v.at < SAVED_LIST_MAX_AGE_MS
  if (
    key === null || !fresh || !Array.isArray(v.items) || !v.items.every(isItemDto) ||
    !isThumbMap(v.circuitThumbs) || !isMeta(value) || !isExtras(v.extras) ||
    !(v.etag === null || typeof v.etag === 'string')
  ) {
    return null
  }
  return v as unknown as SavedList
}

export function toListValue(saved: SavedList): ListValue {
  return {
    items: saved.items.map(reviveItem),
    total: saved.total,
    page: saved.page,
    pageCount: saved.pageCount,
    circuitThumbs: saved.circuitThumbs,
    extras: saved.extras,
    etag: saved.etag,
    etagThrough: saved.page,
  }
}

// 読み戻した値 → 残した時刻。確かめる前にもう一度残すとき、古さを引き継ぐ
const savedAtOf = new WeakMap<ListValue, number>()

async function hydrate(now: number): Promise<void> {
  const record = await getRecord('lists', LISTS_RECORD_KEY)
  const lists = Array.isArray(record) ? record : []
  for (const raw of lists) {
    const saved = parseSavedList(raw, now)
    if (saved !== null) {
      // 時刻は 0 (期限切れ) で入れる。画面が鍵を購読したら必ず確かめに行く —
      // 別の端末で書き換えた分を拾うため。変わっていなければ 304 で済む
      const value = toListValue(saved)
      savedAtOf.set(value, saved.at)
      listCache.seed(saved.key, value, 0)
    }
  }
}

// 今の控えから残す分を選ぶ。新しく使った順 (控えの並びの後ろ) から、
// 取り直し待ち・失敗していない物だけ。
//
// **シークレット内検索の間に探した語の一覧は残さない** (docs/130 §6)。控えは
// 検索語を鍵にして 30 日残るので、断片の中身を探した語 (口座番号など) が
// 端末に平文で残ってしまう。検索履歴に残さないのと同じ線引き
function collectLists(now: number): SavedList[] {
  const lists: SavedList[] = []
  for (const key of listCache.keys().reverse()) {
    const entry = listCache.peek(key)
    if (entry?.value === undefined || entry.stale || entry.loading || entry.error) {
      continue
    }
    if (isSecretSearchedQuery(key.query)) {
      continue
    }
    lists.push(toSavedList(key, entry.value, entry.at || (savedAtOf.get(entry.value) ?? now)))
    if (lists.length >= MAX_SAVED_LISTS) {
      break
    }
  }
  return lists
}

// 前に書いた時の値の組。同じなら書かない
function snapshotToken(): string {
  return listCache
    .keys()
    .map((key) => {
      // 残さない語かどうかも組に入れる。既に書いた後で印が付いたら書き直す
      const secret = isSecretSearchedQuery(key.query) ? 1 : 0
      return `${listKeyOf(key)}\u0001${listCache.peek(key)?.at ?? 0}\u0001${secret}`
    })
    .join('\u0002')
}

let started = false

// 一度だけ始める。読み戻しを始め、控えが動いたら少し待って書く
export function startListPersistence(): void {
  if (started || typeof indexedDB === 'undefined') {
    return
  }
  started = true
  const hydration = hydrate(Date.now()).catch((error: unknown) => {
    console.warn('一覧の控えを読み戻せませんでした', error)
  })
  setListHydration(hydration)
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastToken = ''
  const scheduleSave = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const token = snapshotToken()
      if (token === lastToken) {
        return
      }
      lastToken = token
      // 読み戻しより先に書くと、残っていた分を消してしまう
      void hydration
        .then(() => putRecord('lists', LISTS_RECORD_KEY, collectLists(Date.now())))
        .catch((error: unknown) => {
          console.warn('一覧の控えを残せませんでした', error)
        })
    }, SAVE_DELAY_MS)
  }
  listCache.subscribe(scheduleSave)
  // 語に「残さない」印が付いたら、既に書いた控えからも除く
  subscribeSecretSearchedQueries(scheduleSave)
}
