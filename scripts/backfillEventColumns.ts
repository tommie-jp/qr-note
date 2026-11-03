// 既存の全ノートの memo から予定の派生列 (event_start / event_end / event_repeat)
// を作り直す (docs/126 §1-2)。正本は memo なので、いつでも再実行して整合を
// 回復できる。冪等: 違う行だけ書く。
//
// 列を足した移行は既存行を NULL のまま置く。2026-11-03 時点で本番に date= を
// 持つノートは 0 件なので導入時は不要。解釈の規則を変えたときに流す。
//
// 使い方: npx tsx --conditions=react-server scripts/backfillEventColumns.ts
//   (本番/デモへは ./doBackfill.sh events 経由)
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { eventColumnsOf } from '@/modules/calendar/event/eventColumns'

const sameTime = (a: Date | null, b: Date | null): boolean => (a?.getTime() ?? null) === (b?.getTime() ?? null)

async function main(): Promise<void> {
  const items = await prisma.item.findMany({
    select: { itemId: true, memo: true, eventStart: true, eventEnd: true, eventRepeat: true },
  })
  console.log(`対象: ${items.length} 件`)

  let updated = 0
  for (const item of items) {
    const next = eventColumnsOf(item.memo)
    if (
      sameTime(next.eventStart, item.eventStart) &&
      sameTime(next.eventEnd, item.eventEnd) &&
      next.eventRepeat === item.eventRepeat
    ) {
      continue
    }
    // 派生値の作り直しは「編集」ではないので、@updatedAt を動かさない生 SQL で書く
    await prisma.$executeRaw`
      UPDATE items
      SET event_start = ${next.eventStart}, event_end = ${next.eventEnd}, event_repeat = ${next.eventRepeat}
      WHERE id = ${item.itemId}::uuid
    `
    updated += 1
    console.log(`  ${item.itemId}: ${next.eventStart?.toISOString() ?? '-'}`)
  }

  console.log(`更新: ${updated} 件 / 変更なし: ${items.length - updated} 件`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
