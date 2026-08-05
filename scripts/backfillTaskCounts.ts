// 既存の全ノートの memo からタスク数を数え直し items.task_todo / task_done を
// 埋め直す (docs/56-チェック検索計画.md §4)。task_todo / task_done は memo 由来の
// 派生キャッシュのため、いつでも再実行して整合を回復できる。
// 冪等: 何度実行しても結果は同じ (countTasks は純関数)。
//
// 列を足したマイグレーションが既存行を 0 のまま置くので、導入直後に 1 回必要。
// SQL で埋めないのは、Markdown の解析が要る (コードフェンスの中の `- [ ]` を
// 数えない) ため。
//
// ゴミ箱の行も対象にする。復元したときに数が 0 のままでは is:todo に出ない。
//
// 使い方: npx tsx scripts/backfillTaskCounts.ts
//   (本番/デモへは ./doBackfillTaskCounts.sh 経由。リモートにはソースが無い)
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { countTasks } from '@/lib/taskCheckbox'

async function main(): Promise<void> {
  const items = await prisma.item.findMany({
    select: { itemNo: true, memo: true, taskTodo: true, taskDone: true },
  })
  console.log(`対象: ${items.length} 件`)

  let updated = 0
  for (const item of items) {
    const { todo, done } = countTasks(item.memo)
    // 内容が変わらないものは書き込まない。
    if (todo === item.taskTodo && done === item.taskDone) {
      continue
    }
    // 数は memo 由来の派生値。バックフィルは「編集」ではないので、
    // @updatedAt を発火させない生 SQL で更新し、並び順 (更新日順) を保つ。
    await prisma.$executeRaw`
      UPDATE items SET task_todo = ${todo}, task_done = ${done}
      WHERE item_no = ${item.itemNo}
    `
    updated += 1
    console.log(`  ${item.itemNo}: todo=${todo} done=${done}`)
  }

  console.log(`更新: ${updated} 件 / 変更なし: ${items.length - updated} 件`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
