// 検索 API (GET /api/items) の中身を組み立てる (docs/123 §1-3)。
//
// サーバ描画の頃の lib/search/pageData.ts と同じ材料を引くが、**JSX と
// HTML は作らない**。一覧のプレビュー (buildNotePreviews) と数式 (buildMathTexts)
// は本文から端末で作れるので、端末に任せる (どちらも isomorphic な部品)。
//
// 付属情報 (特性表・進捗・ゴミ箱・新規登録の導線) は 1 ページ目だけに載せる。
// 続きのページは行が足されるだけで、付属情報は変わらない
import 'server-only'
import type { CircuitThumbMap } from '@/lib/circuit/types'
import { loadCircuitThumbs } from '@/lib/circuit/thumbs'
import { registerCodeOf, scanRegisterHref } from '@/lib/external/scanRegister'
import { newItemId } from '@/lib/items/itemId'
import {
  countTaskProgress,
  searchItemProps,
  searchItems,
  searchItemsPage,
  type ItemPropsResult,
  type TaskProgress,
} from '@/lib/items/search'
import { countTrashedItems, countTrashedMatches } from '@/lib/items/trash'
import { startPhases, type PerfPhases } from '@/lib/logging/phase'
import { isPerfLogEnabled } from '@/lib/logging/perfSwitch'
import type { ViewMode } from '@/lib/prefs/viewMode'
import { queryHasTagTerm, queryTracksTaskProgress } from '@/lib/search/rewrite'
import type { Sort } from '@/lib/validation'
import { toItemDto, type ItemDto } from './itemDto'
import type { PageMeta } from '@/lib/route/respond'

export interface SearchExtras {
  props: ItemPropsResult
  progress: TaskProgress
  trashCount: number
  trashedMatches: number
  registerHref: string | null
}

export interface SearchPayload {
  items: ItemDto[]
  circuitThumbs: CircuitThumbMap
  // 1 ページ目だけ。続きのページでは null
  extras: SearchExtras | null
}

export interface SearchInput {
  query: string
  page: number
  // 1 より大きければ 1〜through ページの累積を返す (page は 1 のときだけ)
  through?: number
  sort: Sort
  view: ViewMode
}

const EMPTY_PROPS: ItemPropsResult = { rows: [], omitted: 0 }
const EMPTY_PROGRESS: TaskProgress = { done: 0, total: 0 }

export async function loadSearchPayload({
  query,
  page,
  through = 1,
  sort,
  view,
}: SearchInput): Promise<{
  payload: SearchPayload
  meta: PageMeta
  perf: PerfPhases | null
}> {
  const t = startPhases(isPerfLogEnabled())
  const first = page <= 1
  // 特性表はタグ検索のとき、進捗はチェック状態で絞っているときだけ
  // (pageData.ts と同じ条件。docs/08 §4・docs/60 §2)
  const showProps = first && queryHasTagTerm(query)
  const showProgress = first && queryTracksTaskProgress(query)
  const [result, props, trashCount, progress] = await Promise.all([
    t.time('検索', () =>
      through > 1 ? searchItems(query, through, sort) : searchItemsPage(query, page, sort),
    ),
    showProps ? t.time('特性', () => searchItemProps(query, sort)) : Promise.resolve(EMPTY_PROPS),
    first ? t.time('ゴミ箱', () => countTrashedItems()) : Promise.resolve(0),
    showProgress ? t.time('進捗', () => countTaskProgress(query)) : Promise.resolve(EMPTY_PROGRESS),
  ])

  const extras = first ? await loadExtras(query, result.total, trashCount, props, progress) : null

  // キャッシュ済みの SVG を引くだけで描画はしない (docs/68)。
  // 画像表示は全部、それ以外は先頭 1 枚
  const circuitThumbs = await t.time('回路', () =>
    loadCircuitThumbs(result.items, view === 'image' ? 'all' : 'first'),
  )

  return {
    payload: { items: result.items.map(toItemDto), circuitThumbs, extras },
    meta: { total: result.total, page: result.page, pageCount: result.pageCount },
    perf: t.done(),
  }
}

// 0 件のときだけ引く 2 つ (pageData.ts と同じ。docs/10 §3・docs/12 §5)
async function loadExtras(
  query: string,
  total: number,
  trashCount: number,
  props: ItemPropsResult,
  progress: TaskProgress,
): Promise<SearchExtras> {
  const registerCode = total === 0 ? registerCodeOf(query) : null
  const registerHref =
    registerCode === null ? null : scanRegisterHref(newItemId(), registerCode)
  const trashedMatches =
    total === 0 && trashCount > 0 ? await countTrashedMatches(query) : 0
  return { props, progress, trashCount, trashedMatches, registerHref }
}
