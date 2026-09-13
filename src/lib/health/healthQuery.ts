// 健康グラフの元データを DB から引く (docs/83-健康管理フェンス計画.md §5)。
// 集計 (healthSeries.ts) は DB 非依存の純関数で、DB を触るのはここだけ。
// 行の引き方と溢れの作法は items/search.ts の searchItemRows を共有する
// (docs/93-リファクタリング計画.md §4-1)。
import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { HealthSourceRow } from '@/lib/healthSeries'
import { HEALTH_ROW_LIMIT } from '@/lib/items/limits'
import { searchItemRows } from '@/lib/items/search'
import { buildWhere } from '@/lib/items/where'

export interface ItemHealthResult {
  rows: HealthSourceRow[]
  // 上限を超えて読まなかったノート数 (特性表・進捗の表と同じ約束)
  omitted: number
}

// 健康グラフの元データ (docs/83-健康管理フェンス計画.md §5)。
// 進捗の表 (searchItemChecks) の三つ子だが、違いが 2 つある。
//
// **絞りが検索式しかない。** 「チェックを持つ」(HAS_TASKS) に当たる派生列が
// 無いので、記録を持たないノートも上限の 200 件に数えられる。だから
// フェンスにはタグを書く前提で、そのぶん LIMIT が実質的な安全弁になる。
//
// **並び順を選ばせない。** 健康の記録は日付を本文に持っており、並べ替えは
// 集計 (healthSeries) が日付で行う。ここでの順が意味を持つのは「同じ日付が
// 2 つあったらどちらを採るか」だけなので、毎回同じ答えになる番号順で固定する。
export async function searchItemHealth(query: string): Promise<ItemHealthResult> {
  return searchItemRows<HealthSourceRow>(
    buildWhere(query),
    Prisma.sql`
      item_no AS "itemNo",
      memo
    `,
    'itemNo',
    HEALTH_ROW_LIMIT,
  )
}
