import 'server-only'
import { prisma } from '@/lib/db'

// 旧番号 → id の控え (legacy_item_nos。docs/107 §6)。履歴リポジトリの
// notes/<旧番号>.md を notes/<id>.md へ付け替えるときだけ引く。
//
// notesRepo.ts から**動的 import で**呼ぶ。履歴の操作は DB に触らないのが
// あちらの作りで、改名が済んだリポジトリ (= 2 回目以降の起動) では読み込みもしない
export async function legacyItemIds(itemNos: readonly string[]): Promise<Map<string, string>> {
  const rows = await prisma.legacyItemNo.findMany({
    where: { itemNo: { in: [...itemNos] } },
  })
  return new Map(rows.map((row) => [row.itemNo, row.itemId]))
}
