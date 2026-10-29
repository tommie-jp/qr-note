// オフラインの印をまとめて付け外しする (docs/65 §7)。デモは同期の口ごと閉じている
import type { NextResponse } from 'next/server'
import { runCommand } from '@/lib/api/runCommand'
import { setOfflinePins } from '@/lib/commands/bulkCommands'
import { parseItemIdList } from '@/lib/commands/itemIds'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'

export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  const body = await parseJsonBody(request, ({ itemIds, pinned }) => {
    const ids = parseItemIdList(itemIds)
    if (ids === null || typeof pinned !== 'boolean') {
      return null
    }
    // **外すのは 1 件ずつだけ。** 外すと端末の写しが黙って消え、困るのは
    // 圏外に出てから。まとめて外す口は Server Action の頃から持たない
    return !pinned && ids.length > 1 ? null : { itemIds: ids, pinned }
  })
  if (!body.ok) {
    return body.response
  }
  return runCommand('オフラインの印', async () => {
    await setOfflinePins(body.value.itemIds, body.value.pinned)
    return apiOk({ count: body.value.itemIds.length })
  })
}
