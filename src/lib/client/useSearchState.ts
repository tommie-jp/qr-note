// 検索一覧の状態 (検索語・並び順) を URL から読む (docs/123 §4-2)。
//
// 「URL が正」は変えない (docs/11 §3)。違うのは URL の書き換えが
// history.replaceState になったことで、サーバへ RSC を取りに行かない。
// useSearchParams は replaceState に追随する (Next の Native History API)。
//
// 並び順は URL → cookie → 既定。cookie の値はサーバが初回に読んだもの
// (initialCookieSort) を、並び替えの action が searchSortStore で上書きする
'use client'

import { useSearchParams } from 'next/navigation'
import { resolveSort } from '@/lib/prefs/sortMode'
import type { Sort } from '@/lib/validation'
import { searchSortStore } from './searchPrefs'

export interface SearchState {
  query: string
  sort: Sort
  // URL の ?page= (累積で何ページ目まで出すか)。共有された URL・再読み込みの
  // ときだけ 2 以上になる。端末はそこまで足してから止まる
  page: number
}

export function useSearchState(initialCookieSort: Sort): SearchState {
  const params = useSearchParams()
  const cookieSort = searchSortStore.useStore() ?? initialCookieSort
  const query = (params.get('q') ?? '').trim()
  const sort = resolveSort(params.get('sort') ?? undefined, cookieSort)
  const pageText = params.get('page')
  const page = pageText !== null && /^\d{1,4}$/.test(pageText) ? Math.max(1, Number(pageText)) : 1
  return { query, sort, page }
}
