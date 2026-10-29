// 公開・非公開 (docs/22)。デモでは公開機能を封じる (docs/38 §3)
import type { NextResponse } from 'next/server'
import { toItemDto } from '@/lib/api/itemDto'
import { guardItemRoute, type ItemRouteContext } from '@/lib/api/itemRoute'
import { runCommand } from '@/lib/api/runCommand'
import { setNotePublic } from '@/lib/commands/noteCommands'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'

export async function PUT(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  const body = await parseJsonBody(request, ({ isPublic }) =>
    typeof isPublic === 'boolean' ? { isPublic } : null,
  )
  if (!body.ok) {
    return body.response
  }
  const { itemId } = guard
  return runCommand('公開の切り替え', async () => {
    const item = await setNotePublic(itemId, body.value.isPublic)
    return apiOk({ item: toItemDto(item) })
  })
}
