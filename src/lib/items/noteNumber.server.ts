import 'server-only'
import { prisma } from '@/lib/db'
import { firstFreeNoteNumber, NOTE_NUMBER_SQL_PATTERN } from './noteNumber'

// 1000 以上の最小の空き番号 (docs/111-短縮URL計画.md §2-3)。尽きていれば null。
//
// ゴミ箱の行も数える (タグが残っているので、復元したときに番号が重ならない)。
// 全行の unnest は seq scan だが、千数百行なので足りる (read.ts の listTags と
// 同じ判断)。空きを探すのは TS 側 (firstFreeNoteNumber)
export async function nextFreeNoteNumber(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ tag: string }[]>`
    SELECT DISTINCT tag FROM (SELECT unnest(tags) AS tag FROM items) AS t
    WHERE tag ~ ${NOTE_NUMBER_SQL_PATTERN}
  `
  return firstFreeNoteNumber(rows.map((row) => row.tag))
}
