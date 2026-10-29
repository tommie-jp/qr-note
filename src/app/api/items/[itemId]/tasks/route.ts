// タスクリストのチェックを切り替える (docs/55 §4・docs/123 §2-1)
import type { NextResponse } from 'next/server'
import { toItemDto } from '@/lib/api/itemDto'
import { guardItemRoute, type ItemRouteContext } from '@/lib/api/itemRoute'
import { runCommand } from '@/lib/api/runCommand'
import { toggleTask } from '@/lib/commands/noteCommands'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'

export async function PATCH(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context)
  if (!guard.ok) {
    return guard.response
  }
  const body = await parseJsonBody(request, ({ line, checked }) =>
    typeof line === 'number' && Number.isInteger(line) && line >= 1 && typeof checked === 'boolean'
      ? { line, checked }
      : null,
  )
  if (!body.ok) {
    return body.response
  }
  const { itemId } = guard
  return runCommand('チェックの切り替え', async () => {
    const item = await toggleTask(itemId, body.value.line, body.value.checked)
    return apiOk({ item: toItemDto(item) })
  })
}
