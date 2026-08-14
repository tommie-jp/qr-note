import { cookies } from 'next/headers'
import { findListNeighbors } from '@/lib/items'
import { SORT_COOKIE, resolveSort } from '@/lib/sortMode'
import type { Sort } from '@/lib/validation'

export interface ItemListContext {
  query: string
  sort: Sort
  neighbors: { prev: string | null; next: string | null }
}

// /item を開いたときの「一覧の文脈」(q / sort / 前後) の解決
// (docs/60-学習進捗計画.md §4)。全画面 (item/[itemNo]/page.tsx) と横取り
// プレビュー ((search)/@detail) が**同じ規則を共有する**ための 1 か所 —
// 別々に育つと、同じ URL なのにペインと全画面で「次」が違うノートを指す。
//
// - `?q=a&q=b` と同じ名前を 2 回書いた URL では配列で届くので先頭を採る。
//   落として素の URL 扱いにすると「一覧から来たのにナビが無い」になる
// - 並び順は resolveSort (URL → cookie → 既定)。cookie だけを見ると
//   `?sort=` 付きの共有リンクから入ったときに一覧と順序が食い違う
// - 検索状態を持って来ていない (QR シールから直接開いた) ときは前後を引かない
export async function resolveItemListContext(
  itemNo: string,
  q: string | string[] | undefined,
  sortParam: string | string[] | undefined,
): Promise<ItemListContext> {
  const query = (Array.isArray(q) ? (q[0] ?? '') : (q ?? '')).trim()
  // resolveSort は unknown を受けて parseSort で畳むので、配列はそのまま
  // 渡してよい (知らない値として既定へ倒れる)
  const sort = resolveSort(sortParam, (await cookies()).get(SORT_COOKIE)?.value)
  const neighbors = query
    ? await findListNeighbors(query, sort, itemNo)
    : { prev: null, next: null }
  return { query, sort, neighbors }
}
