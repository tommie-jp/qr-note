// 検索フォルダーの中身 (docs/86 §5・docs/123 §4-3)。
// タグの出し分け (folderTags) までサーバで済ませる — 件数で足切りする規則を
// 端末に写すと、2 か所で数字がずれる
import type { NextResponse } from 'next/server'
import { countFolderTotals, listTags } from '@/lib/items/read'
import { countTrashedItems } from '@/lib/items/trash'
import { folderTags } from '@/lib/search/folderTags'
import { listQueries } from '@/lib/search/queryStore'
import { guardRequest } from '@/lib/route/guard'
import { apiOk } from '@/lib/route/respond'

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  const [tags, totals, trashCount, queryLists] = await Promise.all([
    listTags(),
    countFolderTotals(),
    countTrashedItems(),
    listQueries(guard.user),
  ])
  const { shown, hidden } = folderTags(tags)
  return apiOk({ tags: shown, hiddenTags: hidden, totals, trashCount, saved: queryLists.saved })
}
