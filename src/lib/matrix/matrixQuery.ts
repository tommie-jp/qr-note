// 進捗の表の元データを DB から引く (docs/77-進捗マトリックス計画.md §4)。
// 表に畳む (matrixTable.ts) のは DB 非依存の純関数で、DB を触るのはここだけ。
// 行の引き方と溢れの作法は items/search.ts の searchItemRows を共有する
// (docs/93-リファクタリング計画.md §4-1)。
import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { MATRIX_ROW_LIMIT } from '@/lib/items/limits'
import { searchItemRows } from '@/lib/items/search'
import { buildChecksWhere } from '@/lib/items/where'
import type { MatrixSourceRow } from '@/lib/matrixTable'
import type { Sort } from '@/lib/validation'

export interface ItemChecksResult {
  rows: MatrixSourceRow[]
  // 上限を超えて表に載らなかった件数 (特性表と同じ約束。黙って打ち切らない)
  omitted: number
}

// 進捗の表の元データ (docs/77-進捗マトリックス計画.md §4)。
// **特性表 (searchItemProps) の双子** — 絞りが「プロパティを持つ」から
// 「チェックを持つ」に変わり、取る列が props から task_todo/task_done に
// 変わるだけで、上限・溢れ・並びの作法はそのまま。
//
// memo を返すのは、行の見出し (要約) とチェックの名前の両方が本文から
// 決まるため。クライアントへ渡る形へ畳むのは buildMatrixTable の仕事で、
// そこで memo は捨てられる。
export async function searchItemChecks(
  query: string,
  sort: Sort = 'itemNo',
): Promise<ItemChecksResult> {
  return searchItemRows<MatrixSourceRow>(
    buildChecksWhere(query),
    Prisma.sql`
      item_no   AS "itemNo",
      memo,
      task_todo AS "taskTodo",
      task_done AS "taskDone"
    `,
    sort,
    MATRIX_ROW_LIMIT,
  )
}
