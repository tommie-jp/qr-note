// 選んだノートにタグをまとめて足す・外す (一括タグ)。mode=restore は
// 外したタグを元の位置に戻す (選択モードの「元に戻す」)
import type { NextResponse } from 'next/server'
import { runCommand } from '@/lib/api/runCommand'
import { applyBulkTags, restoreRemovedTagChanges } from '@/lib/commands/bulkCommands'
import { parseItemIdList } from '@/lib/commands/itemIds'
import { parseTagChanges, parseTagInput, type TagChange } from '@/lib/markdown/tags/bulk'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'

// タグの入力欄の上限。parseTagInput も 1000 字で切るので、それより長い送信は形が違う
const MAX_TAGS_INPUT = 1000

type TagRequest =
  | { mode: 'add' | 'remove'; itemIds: string[]; tags: string[] }
  | { mode: 'restore'; changes: TagChange[] }

// 取り消しの要求は端末の控えをそのまま送り返してくる。id の形・重複・件数の
// 上限は parseItemIdList、タグは入力欄と同じ parseTagInput で読み直す
function parseRestoreChanges(changes: unknown): TagChange[] | null {
  if (!Array.isArray(changes)) {
    return null
  }
  const parsed = parseTagChanges({ changes })
  const ids = new Set(parseItemIdList(parsed.map((change) => change.itemId)))
  return parsed.flatMap((change) => {
    const tags = parseTagInput(change.tags.join(' '))
    // delete … 同じ id の 2 つ目以降は受けない
    if (!ids.delete(change.itemId) || tags.length === 0) {
      return []
    }
    return [{ ...change, tags }]
  })
}

function parseTagRequest(body: Readonly<Record<string, unknown>>): TagRequest | null {
  const { mode, itemIds, tags, changes } = body
  if (mode === 'restore') {
    const parsed = parseRestoreChanges(changes)
    return parsed === null ? null : { mode, changes: parsed }
  }
  const ids = parseItemIdList(itemIds)
  if (
    ids === null ||
    (mode !== 'add' && mode !== 'remove') ||
    typeof tags !== 'string' ||
    tags.length > MAX_TAGS_INPUT
  ) {
    return null
  }
  return { mode, itemIds: ids, tags: parseTagInput(tags) }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  const body = await parseJsonBody(request, parseTagRequest)
  if (!body.ok) {
    return body.response
  }
  const value = body.value
  if (value.mode === 'restore') {
    return runCommand('一括タグの取り消し', async () => {
      await restoreRemovedTagChanges(value.changes)
      return apiOk({ count: value.changes.length })
    })
  }
  return runCommand('一括タグ', async () => {
    const changes = await applyBulkTags(value.mode, value.itemIds, value.tags)
    // changes … ノートごとに実際に増えた (外れた) タグ。端末が取り消しに使う
    return apiOk({ count: value.itemIds.length, changes })
  })
}
