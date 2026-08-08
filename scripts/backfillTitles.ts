// 既存の全ノートの memo から見出しを切り出し直し items.title を埋め直す
// (docs/63-タイトル順計画.md §4)。title は memo 由来の派生キャッシュのため、
// いつでも再実行して整合を回復できる。
// 冪等: 何度実行しても結果は同じ (memoSummary は純関数)。
//
// 列を足したマイグレーションが既存行を '' のまま置くので、導入直後に 1 回必要。
// SQL で埋めないのは、Markdown の解析が要る (コードフェンスや折りたたみの中の
// 行を見出しにしない) ため。
//
// ゴミ箱の行も対象にする。復元したときに見出しが '' のままではタイトル順の
// 末尾に落ちる。
//
// URL モードの行は memo が空なので title も '' になる。タイトル順は
// そのとき url を見る (src/lib/sortOrder.ts) ので、ここで url を入れてはいけない
// —— 正本が二重になる。
//
// 使い方: npx tsx scripts/backfillTitles.ts
//   (本番/デモへは ./doBackfillTitles.sh 経由。リモートにはソースが無い)
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { memoSummary } from '@/lib/memoSummary'

async function main(): Promise<void> {
  const items = await prisma.item.findMany({
    select: { itemNo: true, memo: true, title: true },
  })
  console.log(`対象: ${items.length} 件`)

  let updated = 0
  for (const item of items) {
    const title = memoSummary(item.memo)
    // 内容が変わらないものは書き込まない。
    if (title === item.title) {
      continue
    }
    // 見出しは memo 由来の派生値。バックフィルは「編集」ではないので、
    // @updatedAt を発火させない生 SQL で更新し、並び順 (更新日順) を保つ。
    await prisma.$executeRaw`
      UPDATE items SET title = ${title} WHERE item_no = ${item.itemNo}
    `
    updated += 1
    console.log(`  ${item.itemNo}: ${title || '(無題)'}`)
  }

  console.log(`更新: ${updated} 件 / 変更なし: ${items.length - updated} 件`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
