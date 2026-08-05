// Ver1 (MongoDB) の mongoexport 出力を PostgreSQL に移行する。
// 冪等: 何度実行しても同じ結果になる (upsert + 元タイムスタンプ保持)。
//
// **memo 由来の派生列 (tags / props / task_todo / task_done) は埋めない。**
// ここは upsertMemo を通さず memo を直接書くため。既存ノートを上書きしたときは
// 古い値が残る (0 ではなく**ずれた値**になるので、検索が静かに誤答する)。
// 実行したあとは必ず 3 つのバックフィルを流すこと:
//   npx tsx scripts/backfillTags.ts
//   npx tsx scripts/backfillProps.ts
//   npx tsx scripts/backfillTaskCounts.ts
//
// 使い方: npx tsx scripts/migrateFromVer1.ts <item.json のパス>
// 出力:   <item.json と同じディレクトリ>/migration-report.json
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/db'
import {
  dedupeVer1Items,
  transformVer1Item,
  type Ver1ItemDoc,
} from '@/lib/migration'

async function main(): Promise<void> {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error(
      '使い方: npx tsx scripts/migrateFromVer1.ts <item.json のパス>',
    )
    process.exit(1)
  }

  const lines = fs
    .readFileSync(inputPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
  const docs: Ver1ItemDoc[] = lines.map((line) => JSON.parse(line))
  console.log(`入力: ${docs.length} ドキュメント (${inputPath})`)

  const { winners, skipped } = dedupeVer1Items(docs)
  console.log(`重複解決: 採用 ${winners.length} 件 / 除外 ${skipped.length} 件`)

  const items = winners.map(transformVer1Item)
  for (const item of items) {
    await prisma.item.upsert({
      where: { itemNo: item.itemNo },
      update: item,
      create: item,
    })
  }

  const dbCount = await prisma.item.count()
  if (dbCount < items.length) {
    throw new Error(`DB 件数 ${dbCount} が投入件数 ${items.length} より少ない`)
  }
  console.log(`投入完了: ${items.length} 件 (DB 総件数: ${dbCount})`)

  const reportPath = path.join(
    path.dirname(inputPath),
    'migration-report.json',
  )
  const report = {
    input: inputPath,
    totalDocs: docs.length,
    imported: items.length,
    skippedDuplicates: skipped,
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`レポート: ${reportPath} (除外ドキュメントを保全)`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('移行失敗:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
