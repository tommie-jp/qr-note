// GET の口が受け取るクエリ文字列を検める (docs/123 §7)。
//
// 外から来る値なので、形が違えば既定へ倒すのではなく null を返して 400 にする
// ものと、既定へ倒してよいもの (並び順・表示モード。cookie と同じ扱い) を分ける
import { parseViewMode, type ViewMode } from '@/lib/prefs/viewMode'
import { MAX_TEXT_LENGTH, parseSort, type Sort } from '@/lib/validation'

// 検索語の上限。本文の上限より長い語は当たりようがない
export const MAX_QUERY_LENGTH = 1000

// ページの上限。20 件 × 1000 ページ = 2 万件。個人の規模を大きく超える
export const MAX_PAGE = 1000

export interface ListQuery {
  query: string
  page: number
  // 1 ページ目から何ページ目までをまとめて返すか (1 なら page のページだけ)。
  // 書き込みの後の取り直しで、読み進めた所まで 1 回で引き直すため
  through: number
  sort: Sort
  view: ViewMode
}

function parsePageNumber(text: string | null, fallback: number): number | null {
  if (text === null) {
    return fallback
  }
  if (!/^\d{1,4}$/.test(text)) {
    return null
  }
  const n = Number(text)
  return n < 1 || n > MAX_PAGE ? null : n
}

export function parseListQuery(url: URL): ListQuery | null {
  const query = (url.searchParams.get('q') ?? '').trim()
  if (query.length > Math.min(MAX_QUERY_LENGTH, MAX_TEXT_LENGTH)) {
    return null
  }
  const page = parsePageNumber(url.searchParams.get('page'), 1)
  const through = parsePageNumber(url.searchParams.get('through'), 1)
  // まとめて返すのは 1 ページ目からだけ (続きのページと混ぜない)
  if (page === null || through === null || (through > 1 && page !== 1)) {
    return null
  }
  return {
    query,
    page,
    through,
    sort: parseSort(url.searchParams.get('sort')),
    view: parseViewMode(url.searchParams.get('view')),
  }
}
