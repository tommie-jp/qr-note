// オフラインでのノート検索 (docs/65-オフライン対応計画.md §3-3)。
//
// **検索窓の文法はサーバと 1 つの実装を共有する**のが要点。search.ts の
// パーサ (DNF ではなく AST) をそのまま呼び、差し替えるのは葉の評価だけにする。
// 文法を書き写すと、演算子を足したときにオンラインとオフラインで解釈が割れる
// — しかも割れたことに気づくのは圏外だけ、という最悪の壊れ方をする。
//
// 葉の評価の対応 (items.ts の termCondition と対で読むこと):
//
//   text … PGroonga の `memo &@ 語 OR url &@ 語 OR item_no ILIKE 語%`
//          → 正規化済み文字列の部分一致 + itemNo の前方一致。
//          `&@` はバイグラムの全文一致なので厳密には別物だが、「メモ内の
//          部分文字列を探す」用途では体感差が出ない (docs/65 の調査結果)。
//          むしろ部分一致のほうが直感どおりのことも多い。
//   tag  … `tags @> ARRAY[語]` → 配列の完全一致。タグ名は保存時に正規化済み。
//   task … `task_todo > 0` / `task_done > 0` → そのまま数を見る。
//
// 正規化 (NFKC + 小文字化) は normalizeTag をそのまま使う。名前はタグ用だが
// 規則は PGroonga の NormalizerAuto (全半角・大小の同一視) に揃えたもので、
// search.ts も OR 演算子の判定に同じ関数を使っている。

import { parseSearchExpr, type SearchExpr, type SearchTerm } from '@/lib/search'
import { normalizeTag } from '@/lib/tags'
import type { OfflineItem } from './item'

// ノート 1 件と、その検索対象を正規化して畳んだもの。
//
// 打鍵のたびに全件を NFKC で畳み直すと数百件でも体感に出るので、読み込み時に
// 1 度だけ作る。**評価器はここに無い値を見ない** — tags と taskTodo/taskDone は
// 正規化の要らない値なので item から直接読む。
export interface OfflineIndexEntry {
  item: OfflineItem
  // memo と url を正規化して連結したもの。両方を 1 本の文字列で見るのは、
  // `&@` が memo か url のどちらかに当たれば良いのと同じ判定になるため。
  // 改行で挟んで、memo の末尾と url の先頭が繋がって偽の一致を作らないようにする
  haystack: string
  itemNoKey: string
}

export function buildOfflineIndex(
  items: readonly OfflineItem[],
): OfflineIndexEntry[] {
  return items.map((item) => ({
    item,
    haystack: normalizeTag(`${item.memo}\n${item.url}`),
    itemNoKey: normalizeTag(item.itemNo),
  }))
}

// 検索語 1 つの判定。語種ごとに必ず case を書く (items.ts の termCondition と
// 同じ網羅 switch)。text へ落ちる既定にすると、種別を足したときに黙って
// 全文検索へ流れる
function matchesTerm(entry: OfflineIndexEntry, term: SearchTerm): boolean {
  switch (term.kind) {
    case 'tag':
      // タグ名は保存時 (extractTags) と解析時 (parseTagToken) の両方で
      // 正規化済みなので、ここでは畳み直さず完全一致で比べる
      return entry.item.tags.includes(term.value)
    case 'task':
      return term.value === 'todo'
        ? entry.item.taskTodo > 0
        : entry.item.taskDone > 0
    case 'text': {
      const needle = normalizeTag(term.value)
      return entry.haystack.includes(needle) || entry.itemNoKey.startsWith(needle)
    }
  }
}

// AST を再帰的に評価する。exprCondition (items.ts) の SQL 版と同じ形なので、
// 片方を直したらもう片方も直すこと
function matchesExpr(entry: OfflineIndexEntry, expr: SearchExpr): boolean {
  switch (expr.op) {
    case 'term':
      return matchesTerm(entry, expr.term)
    case 'not':
      return !matchesExpr(entry, expr.child)
    case 'and':
      return expr.children.every((child) => matchesExpr(entry, child))
    case 'or':
      return expr.children.some((child) => matchesExpr(entry, child))
  }
}

// 検索クエリに当たるノートを、渡された索引の順のまま返す。
// 並べ替えは order.ts の役目 (SQL の WHERE と ORDER BY が別なのと同じ切り分け)。
//
// 空クエリ (絞り込みなし) は全件。サーバ側も同じで、一覧ブラウズになる。
// ゴミ箱の除外はここでは要らない — 同期 API がそもそも運んでこない。
export function filterOfflineItems(
  index: readonly OfflineIndexEntry[],
  query: string,
): OfflineItem[] {
  const expr = parseSearchExpr(query)
  if (expr === null) {
    return index.map((entry) => entry.item)
  }
  return index.flatMap((entry) => (matchesExpr(entry, expr) ? [entry.item] : []))
}
