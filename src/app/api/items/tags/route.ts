// 選んだノートにタグをまとめて足す・外す (一括タグ)
import type { NextResponse } from 'next/server'
import { runCommand } from '@/lib/api/runCommand'
import { applyBulkTags } from '@/lib/commands/bulkCommands'
import { parseItemIdList } from '@/lib/commands/itemIds'
import { parseTagInput } from '@/lib/markdown/tags/bulk'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'

// タグの入力欄の上限。parseTagInput も 1000 字で切るので、それより長い送信は形が違う
const MAX_TAGS_INPUT = 1000

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  const body = await parseJsonBody(request, ({ mode, itemIds, tags }) => {
    const ids = parseItemIdList(itemIds)
    if (
      ids === null ||
      (mode !== 'add' && mode !== 'remove') ||
      typeof tags !== 'string' ||
      tags.length > MAX_TAGS_INPUT
    ) {
      return null
    }
    return { mode: mode as 'add' | 'remove', itemIds: ids, tags: parseTagInput(tags) }
  })
  if (!body.ok) {
    return body.response
  }
  return runCommand('一括タグ', async () => {
    await applyBulkTags(body.value.mode, body.value.itemIds, body.value.tags)
    return apiOk({ count: body.value.itemIds.length })
  })
}
