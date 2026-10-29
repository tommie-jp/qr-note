// ゴミ箱の出し入れ (docs/12・docs/123 §2-1)。op で 4 つを撃ち分ける
import type { NextResponse } from 'next/server'
import { runCommand } from '@/lib/api/runCommand'
import { applyTrashOp, type TrashOp } from '@/lib/commands/bulkCommands'
import { parseItemIdList } from '@/lib/commands/itemIds'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { toItemDto } from '@/lib/api/itemDto'
import { loadCircuitThumbs } from '@/lib/circuit/thumbs'
import { listTrashedItems } from '@/lib/items/trash'
import { parseViewMode } from '@/lib/prefs/viewMode'
import { apiOkGzip } from '@/lib/route/compress'
import { apiOk } from '@/lib/route/respond'
import { parseTrashSort } from '@/lib/validation'

// ゴミ箱の一覧 (docs/12・docs/123 §4-3)。並び順は ?sort= (既定は削除順)。
// プレビューと数式は端末が本文から作る (検索の口と同じ)
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  const url = new URL(request.url)
  const sort = parseTrashSort(url.searchParams.get('sort'))
  const view = parseViewMode(url.searchParams.get('view'))
  const items = await listTrashedItems(sort)
  const circuitThumbs = await loadCircuitThumbs(items, view === 'image' ? 'all' : 'first')
  // ゴミ箱は全件を 1 回で返すので圧縮する (検索の口と同じ)
  return apiOkGzip({ items: items.map(toItemDto), circuitThumbs }, request)
}

const TRASH_OPS: readonly TrashOp[] = ['trash', 'restore', 'purge', 'empty']

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  const body = await parseJsonBody(request, ({ op, itemIds }) => {
    if (!TRASH_OPS.includes(op as TrashOp)) {
      return null
    }
    // empty は id を取らない
    const ids = op === 'empty' ? [] : parseItemIdList(itemIds)
    return ids === null ? null : { op: op as TrashOp, itemIds: ids }
  })
  if (!body.ok) {
    return body.response
  }
  return runCommand('ゴミ箱の操作', async () => {
    await applyTrashOp(body.value.op, body.value.itemIds)
    return apiOk({ count: body.value.itemIds.length })
  })
}
