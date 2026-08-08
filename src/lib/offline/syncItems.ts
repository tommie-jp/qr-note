// 同期 API がノートを引くところ (docs/65-オフライン対応計画.md §3-1)。
//
// **サーバ専用**。prisma を読むので、クライアントから import してはいけない
// (共有したい型と定数は item.ts が持つ。thumbnail.ts が定数のつもりの import で
// sharp をクライアントへ漏らした件と同じ落とし穴)。
//
// 差分同期はしない。全ノートで数百 KB しかなく (docs/65 §3-2)、差分にすると
// 「消えたノートを端末からも消す」処理が別に要る — 毎回まるごと置き換えれば、
// 端末側は常にサーバの写しになり、消えたノートも自然に消える。

import { prisma } from '@/lib/db'
import { OFFLINE_SYNC_LIMIT, type OfflineItem, type OfflineSyncPayload } from './item'

// ゴミ箱のノートは運ばない。オフラインではゴミ箱も復元も出さないので、
// 端末に置いても検索を濁らせるだけになる。
//
// 上限に届いたときのために更新の新しい順で引く。打ち切るなら、最近書いた
// ものが残るほうが現場で役に立つ (docs/65 の想定は「棚の前で引く」)。
export async function loadOfflineSyncPayload(): Promise<OfflineSyncPayload> {
  // 上限より 1 件だけ多く取り、溢れているかを 1 クエリで判定する
  // (件数用に count を撃つより安い。searchItemProps と同じ手)
  const rows = await prisma.item.findMany({
    where: { deletedAt: null },
    select: {
      itemNo: true,
      itemNoNum: true,
      memo: true,
      url: true,
      mode: true,
      title: true,
      tags: true,
      taskTodo: true,
      taskDone: true,
      updatedAt: true,
      accessedAt: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { itemNo: 'asc' }],
    take: OFFLINE_SYNC_LIMIT + 1,
  })

  const truncated = rows.length > OFFLINE_SYNC_LIMIT
  const items: OfflineItem[] = rows.slice(0, OFFLINE_SYNC_LIMIT).map((row) => ({
    ...row,
    // Date は JSON を跨ぐと文字列に化けるので、型のうえでも先に文字列にする。
    // toISOString の形 (桁数・UTC 固定) は order.ts が辞書順の比較で使う
    updatedAt: row.updatedAt.toISOString(),
    accessedAt: row.accessedAt.toISOString(),
  }))

  return {
    // サーバの時刻を正にする (端末の時計を信じない。item.ts の syncedAt 参照)
    syncedAt: new Date().toISOString(),
    items,
    truncated,
  }
}
