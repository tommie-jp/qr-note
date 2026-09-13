// 検索一覧と、検索ヒットから表・進捗を作る元データ (docs/93-リファクタリング計画.md §4-1)。
// SQL の断片は where.ts が組み、ここはクエリを撃って結果の形を整える。
import 'server-only'
import { prisma } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import type { Item } from '@/generated/prisma/client'
import { memoSummary } from '@/lib/memoSummary'
import { parseStoredProps, type ItemPropsRow } from '@/lib/props'
import type { Sort, TrashSort } from '@/lib/validation'
import { PAGE_SIZE, PROPS_TABLE_LIMIT } from './limits'
import {
  ALL_CHECKED,
  buildOrderBy,
  buildProgressWhere,
  buildPropsWhere,
  buildWhere,
  ITEM_COLUMNS,
} from './where'

export interface ItemSearchResult {
  items: Item[]
  total: number
  page: number
  pageCount: number
}

// WHERE 句に当たる件数。一覧の総数、表・グラフが溢れたときの本当の総数
// (溢れていなければ撃たない)、0 件検索時のゴミ箱の案内が使う。
export async function countItemsWhere(where: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM items ${where}
  `
  return rows[0]?.count ?? 0
}

// q は memo / url の全文検索 (&@)、または itemNo の前方一致。
// 空白 (半角/全角) 区切りは AND、"OR"/"|" は OR (DNF)。文法は search.ts 参照。
//
// page N は「N ページ目の 20 件」ではなく「1〜N ページ目の累積」を返す
// (docs/33-オンデマンド表示計画.md §2)。オンデマンド表示の要:
// クライアントは蓄積 state を持たず、URL の ?page=N だけで表示範囲が決まる。
// 毎回先頭から引き直すので OFFSET 型の重複/欠落も起きない。
// 個人規模 (数百〜数千件) では全件でも誤差 (docs/15 §2-2 と同じ判断)。
export async function searchItems(
  query: string,
  page: number,
  sort: Sort = 'updated',
): Promise<ItemSearchResult> {
  const where = buildWhere(query)

  const total = await countItemsWhere(where)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // floor が要る: ?page=1.5 のような値をそのまま掛けると LIMIT 30 になり、
  // 半端な page が次ページの URL にも伝播する
  const intPage = Math.floor(page)
  const safePage = Math.min(
    Math.max(1, Number.isFinite(intPage) ? intPage : 1),
    pageCount,
  )
  const limit = safePage * PAGE_SIZE

  const items = await prisma.$queryRaw<Item[]>`
    SELECT ${ITEM_COLUMNS}
    FROM items
    ${where}
    ${buildOrderBy(sort)}
    LIMIT ${limit}
  `

  return { items, total, page: safePage, pageCount }
}

// 表・グラフの元データを引く共通形 (特性表・進捗の表・健康グラフの三つ子)。
// 3 つの違いは絞り (where)・取る列・並び・上限だけで、溢れの作法は同じ。
//
// 上限より 1 件だけ多く取り、溢れているかを 1 クエリで判定する
// (件数用に count を撃つより安い)。溢れたときだけ本当の総数を数えて、
// 表に載らなかった件数 (omitted) を返す
//
// export するのは、進捗の表 (matrix/matrixQuery.ts) と健康グラフ
// (health/healthQuery.ts) も同じ形で引くため。表・グラフを足すときも
// 溢れの作法を書き写さずにここを通す
export async function searchItemRows<T>(
  where: Prisma.Sql,
  columns: Prisma.Sql,
  sort: TrashSort,
  limit: number,
): Promise<{ rows: T[]; omitted: number }> {
  const rows = await prisma.$queryRaw<T[]>`
    SELECT ${columns}
    FROM items
    ${where}
    ${buildOrderBy(sort)}
    LIMIT ${limit + 1}
  `

  const omitted =
    rows.length > limit ? (await countItemsWhere(where)) - limit : 0

  return { rows: rows.slice(0, limit), omitted }
}

export interface ItemPropsResult {
  rows: ItemPropsRow[]
  // 上限を超えて表に載らなかった件数。黙って打ち切ると「これで全部」と
  // 読めてしまうため、呼び出し側が知らせられるように数を返す。
  omitted: number
}

// 特性表の元データ。検索ヒットのうちプロパティを持つノートを、一覧と同じ並びで返す。
// 一覧のページ送りとは独立に全ヒットを対象にするため、LIMIT は PAGE_SIZE ではなく
// PROPS_TABLE_LIMIT (ページを開いても表の中身が変わらないように)。
// 要約はここで作り、memo 全文をクライアントへ送らない。
export async function searchItemProps(
  query: string,
  sort: Sort = 'updated',
): Promise<ItemPropsResult> {
  const { rows, omitted } = await searchItemRows<{
    itemNo: string
    memo: string
    props: unknown
  }>(
    buildPropsWhere(query),
    Prisma.sql`
      item_no AS "itemNo",
      memo,
      props
    `,
    sort,
    PROPS_TABLE_LIMIT,
  )

  return {
    rows: rows.map((row) => ({
      itemNo: row.itemNo,
      summary: memoSummary(row.memo),
      props: parseStoredProps(row.props),
    })),
    omitted,
  }
}

// 学習の進捗 (docs/60-学習進捗計画.md §2)。
// total … 検索からチェック語を外し「チェックを持つ」で絞った件数 (母数)
// done  … そのうち全部チェックしたノート
export interface TaskProgress {
  done: number
  total: number
}

// `#過渡現象 is:todo` のような検索でも、母数は `#過渡現象` のうち
// チェックを持つノート全体になる。**同じ WHERE を 2 度引かない** —
// FILTER 付きの集約 1 本で分母と分子を同時に数える (件数と食い違わない)。
export async function countTaskProgress(query: string): Promise<TaskProgress> {
  const rows = await prisma.$queryRaw<TaskProgress[]>`
    SELECT count(*)::int AS total,
           (count(*) FILTER (WHERE ${ALL_CHECKED}))::int AS done
    FROM items
    ${buildProgressWhere(query)}
  `
  return { done: rows[0]?.done ?? 0, total: rows[0]?.total ?? 0 }
}
