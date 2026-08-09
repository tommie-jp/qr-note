import type { Sort, TrashSort } from './validation'

// 検索一覧 (/) の URL を組み立てる。既定値 (page=1 / sort=updated) は省略して
// 短い URL にする。一覧のページ送り・並び替えリンクと、一括操作後の戻り先で共用する。
export function buildSearchUrl(query: string, page: number, sort: Sort): string {
  const params = new URLSearchParams()
  if (query) {
    params.set('q', query)
  }
  if (page > 1) {
    params.set('page', String(page))
  }
  if (sort !== 'updated') {
    params.set('sort', sort)
  }
  const qs = params.toString()
  return qs ? `/?${qs}` : '/'
}

// ゴミ箱 (/trash) の URL。並び替えたときの行き先で使う
// (docs/67-ゴミ箱表示形式計画.md §2)。
//
// 検索と違って持ち回す物は並び順だけ — ゴミ箱に検索窓もページ送りも無い。
// 既定 (削除順) は省いて素の /trash に畳む (buildSearchUrl と同じ約束)。
export function buildTrashUrl(sort: TrashSort): string {
  return sort === 'deleted' ? '/trash' : `/trash?sort=${sort}`
}

// 一覧からノートを開く URL。検索語と並び順を持ち回し、ノート側の前後ナビ
// (docs/60-学習進捗計画.md §4) が「一覧のどこに居るか」を復元できるようにする。
//
// **`q` が無ければ素の `/item/<no>` に畳む**のが要点。前後ナビを出すかの
// 判定はこの `q` の有無だけで済ませたいので、一覧の文脈が無いとき
// (QR シールから直接開く・空クエリの browse) に印を残さない。
// 並び順だけを載せても前後は決まらないので、q が空なら sort も落とす。
//
// page は載せない。前後は「一覧の何ページ目まで開いたか」とは無関係で、
// 検索条件と並び順だけで決まる (docs/60 §4 の SQL)。
export function buildItemUrl(itemNo: string, query: string, sort: Sort): string {
  const trimmed = query.trim()
  const path = `/item/${encodeURIComponent(itemNo)}`
  if (!trimmed) {
    return path
  }
  const params = new URLSearchParams({ q: trimmed })
  if (sort !== 'updated') {
    params.set('sort', sort)
  }
  return `${path}?${params.toString()}`
}
