import { prisma } from '@/lib/db'
import { backfillNotes } from '@/lib/git/notesRepo'

export interface BackfillResult {
  // 取り込み対象のノート数 (ゴミ箱含む全件)
  count: number
  // 作られたコミット。差分が無ければ null (冪等)
  oid: string | null
}

// 既存の全ノートを git 履歴の起点として 1 コミットで取り込む
// (docs/57-ノートgit履歴計画.md §6)。設定ページ (backfillHistoryAction) と
// scripts/backfillGitHistory.ts の 2 つの入口が同じここを呼ぶ。
//
// ゴミ箱のノートも含める — 復元できるものはすべて履歴の対象。
// per-note のコミットに分けて日時を偽装することはしない (docs/57 §6)。
export async function backfillAllNotes(): Promise<BackfillResult> {
  const items = await prisma.item.findMany({
    select: { itemNo: true, memo: true },
    orderBy: { itemNo: 'asc' },
  })
  const oid = await backfillNotes(items, 'backfill: 既存ノートを取り込み')
  return { count: items.length, oid }
}
