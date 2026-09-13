// ノートの印を書く DB 操作 (公開・オフラインの印・アクセス順)。
// どれも本文の変更ではないので updated_at を動かさない
// (docs/93-リファクタリング計画.md §4-1)。
import 'server-only'
import { prisma } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'

// updated_at を打たずに 1 行を書く (公開・オフラインの印・アクセス順)。
// Prisma の update は @updatedAt を必ず打ってしまうので生 SQL で書く。
//
// condition は「書く必要がある行か」。既に望む状態の行には書かないので、
// 戻り値の件数 0 は正常な結果になりうる
function updateItemQuietly(
  itemNo: string,
  set: Prisma.Sql,
  condition: Prisma.Sql,
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE items SET ${set}
    WHERE item_no = ${itemNo} AND ${condition}
  `
}

// --- 公開 (docs/22-ノート公開計画.md) ---

// ノートを公開する / 公開をやめる。
//
// 「いまの状態を裏返す」ではなく**望む状態を受け取る**。裏返す作りは、
// 二重送信や戻るボタンで意図と逆に倒れる (「1 にせよ」なら何回でも 1)。
//
// updated_at は触らない。本文は変わっていないのに更新順が動くのは嘘になる
// (trashItems / restoreItems と同じ理由)。Prisma の update は @updatedAt を
// 必ず打ってしまうので生 SQL で書く。
//
// WHERE の状態条件が要点: 既に公開中のノートへもう一度「公開」しても
// public_at を上書きしない。押し直すたびに公開日時が今へ進むのは嘘になる。
export async function setItemPublic(itemNo: string, isPublic: boolean): Promise<number> {
  if (isPublic) {
    return updateItemQuietly(
      itemNo,
      Prisma.sql`public_at = now()`,
      Prisma.sql`public_at IS NULL`,
    )
  }
  return updateItemQuietly(
    itemNo,
    Prisma.sql`public_at = NULL`,
    Prisma.sql`public_at IS NOT NULL`,
  )
}

// --- オフラインの印 (docs/65-オフライン対応計画.md §7) ---

// 「オフラインで常に使う」印を立てる / 下ろす。
//
// **updated_at を触らない**ので生 SQL で書く (setItemPublic と同じ理由)。
// 印は読み方の設定であって本文の変更ではないため、付けただけで更新順の
// 先頭に来るのは嘘になる — しかも同期は更新の新しい順に打ち切るので、
// 動かすと「印を付けたノートが他を押し出す」という別の嘘まで生む。
export async function setItemOfflinePin(itemNo: string, pinned: boolean): Promise<number> {
  return updateItemQuietly(
    itemNo,
    Prisma.sql`offline_pin = ${pinned}`,
    Prisma.sql`offline_pin <> ${pinned}`,
  )
}

// --- アクセス順 (docs/37-アクセス順計画.md) ---

// 連打・二重発火を吸収する間隔。リロードや React の StrictMode で
// 同じノートの記録が続けて飛んでくるため
const ACCESS_THROTTLE = '1 minute'

// ノートを「開いた」ことを記録する。
//
// **updated_at は触らない**。見ただけで更新順が動くのは嘘になる
// (trashItems / setItemPublic と同じ理由)。Prisma の update は @updatedAt を
// 必ず打ってしまうので生 SQL で書く。
//
// WHERE の時刻条件は連打よけ。1 分以内に既に記録済みなら何もしない
// (更新行数 0 が正常な結果なので、戻り値で成否を判断しないこと)。
//
// ゴミ箱の行も記録してよい。ゴミ箱から開いて中身を確かめることはあり、
// 復元したときに「最近見た」順で見つかるほうが自然。
export async function recordItemAccess(itemNo: string): Promise<void> {
  await updateItemQuietly(
    itemNo,
    Prisma.sql`accessed_at = now()`,
    Prisma.sql`accessed_at < now() - ${ACCESS_THROTTLE}::interval`,
  )
}
