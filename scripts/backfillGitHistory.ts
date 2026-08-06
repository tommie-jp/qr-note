// 既存の全ノートを git 履歴の起点として 1 コミットで取り込む
// (docs/57-ノートgit履歴計画.md §6)。中身は設定ページ (/settings/history) と
// 同じ backfillAllNotes で、こちらはローカル/自動化用の入口。
// 冪等: 差分が無ければ何もコミットしない。
//
// 使い方: npm run backfill:git
//   (直接: npx tsx scripts/backfillGitHistory.ts)
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { backfillAllNotes } from '@/lib/noteHistoryBackfill'

async function main(): Promise<void> {
  const { count, oid } = await backfillAllNotes()
  console.log(`対象: ${count} 件 (ゴミ箱含む)`)
  console.log(oid === null ? '差分なし (取り込み済み)' : `コミット: ${oid}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
