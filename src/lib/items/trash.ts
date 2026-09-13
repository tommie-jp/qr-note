// ゴミ箱 (二段階削除。docs/12-ゴミ箱計画.md) の DB 操作。
// 入れる・戻す・永久削除・一覧・件数 (docs/93-リファクタリング計画.md §4-1)。
import 'server-only'
import { prisma } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import type { Item } from '@/generated/prisma/client'
import type { TrashSort } from '@/lib/validation'
import { countItemsWhere } from './search'
import {
  buildOrderBy,
  buildTrashedWhere,
  ITEM_COLUMNS,
  NOT_TRASHED,
  TRASHED,
} from './where'

// ゴミ箱へ入れる / 戻す。どちらも updated_at は触らない。本文は変わって
// いないので、削除・復元で更新順が動くのは嘘になるため。Prisma の
// updateMany は @updatedAt を必ず打ってしまうので生 SQL で書く。
//
// from の状態にある行だけを書き換える (既にゴミ箱にある行の deleted_at を
// 動かさない)。2 つの違いは deleted_at に入れる値と from だけ
async function setDeletedAt(
  itemNos: string[],
  deletedAt: Prisma.Sql,
  from: Prisma.Sql,
): Promise<number> {
  if (itemNos.length === 0) {
    return 0
  }
  return prisma.$executeRaw`
    UPDATE items SET deleted_at = ${deletedAt}
    WHERE item_no IN (${Prisma.join(itemNos)}) AND ${from}
  `
}

export async function trashItems(itemNos: string[]): Promise<number> {
  return setDeletedAt(itemNos, Prisma.sql`now()`, NOT_TRASHED)
}

export async function restoreItems(itemNos: string[]): Promise<number> {
  return setDeletedAt(itemNos, Prisma.sql`NULL`, TRASHED)
}

// 永久削除 (DB から消す)。**ゴミ箱にある行しか消さない**のがこの関数の要点で、
// 二段階削除の保証はここにある (UI ではなくサーバ側で担保する)。
// ここで初めて itemNo が解放され、新規ノートに再利用されうる。
//
// 戻り値は件数ではなく**実際に消えた itemNo の列**。呼び出し側 (actions.ts) が
// git の墓石コミットの対象を決めるのに使う — 渡された itemNos をそのまま
// 使うと、ゴミ箱に無くて消えなかったノートの履歴まで墓石が立ってしまう
// (docs/57-ノートgit履歴計画.md §4)。先に SELECT してから消す間に別タブが
// 割り込む競合は理屈上あるが、deleteMany 側の deleted_at 条件が守りの正本で、
// ずれても墓石が 1 回分ずれるだけ (シングルユーザーでは実質起きない)。
export async function purgeItems(itemNos: string[]): Promise<string[]> {
  if (itemNos.length === 0) {
    return []
  }
  return purgeTrashed({ itemNo: { in: itemNos } })
}

// purgeItems と同じ約束で、消えた itemNo の列を返す (墓石コミットの対象)。
export async function emptyTrash(): Promise<string[]> {
  return purgeTrashed({})
}

// 永久削除の共通形。scope に当たる行のうち**ゴミ箱にあるものだけ**を消し、
// 消えた itemNo の列を返す (purgeItems のコメントの約束)
async function purgeTrashed(scope: Prisma.ItemWhereInput): Promise<string[]> {
  const rows = await prisma.item.findMany({
    where: { ...scope, deletedAt: { not: null } },
    select: { itemNo: true },
  })
  if (rows.length === 0) {
    return []
  }
  const targets = rows.map((row) => row.itemNo)
  await prisma.item.deleteMany({
    where: { itemNo: { in: targets }, deletedAt: { not: null } },
  })
  return targets
}

// ゴミ箱の一覧。既定は削除の新しい順で、検索一覧と同じ 4 種別にも並べ替えられる
// (docs/67-ゴミ箱表示形式計画.md §2)。個人利用で数件しか溜まらない前提なので
// ページ送りは無い (「ゴミ箱を空にする」の件数が全件を指す前提でもある)。
//
// **要約ではなく Item をそのまま返す。** 以前は itemNo/summary/deletedAt の
// 3 つだけを返して memo 全文をクライアントへ送らないようにしていたが、
// 大表示の本文プレビューも画像表示のタイルも本文から作るので、要約では
// 描けない。検索一覧 (searchItems) は元から Item[] を返しており、そちらと
// 同じ扱いになるだけ。
export async function listTrashedItems(
  sort: TrashSort = 'deleted',
): Promise<Item[]> {
  return prisma.$queryRaw<Item[]>`
    SELECT ${ITEM_COLUMNS}
    FROM items
    ${buildTrashedWhere('')}
    ${buildOrderBy(sort)}
  `
}

export async function countTrashedItems(): Promise<number> {
  return prisma.item.count({ where: { deletedAt: { not: null } } })
}

// 検索が 0 件のとき、同じ条件がゴミ箱に当たるかを数える (docs/12 §5)。
// 「消したノートを探して 0 件」や、ゴミ箱のノートと同じコードの再スキャンで
// 二重登録しかけたときに、ゴミ箱へ誘導するために使う。0 件のときしか撃たない。
export async function countTrashedMatches(query: string): Promise<number> {
  return countItemsWhere(buildTrashedWhere(query))
}
