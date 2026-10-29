// 番号を振る (docs/111 §6)。デモは種 DB が毎時戻るので閉じる
import type { NextResponse } from 'next/server'
import { toItemDto } from '@/lib/api/itemDto'
import { guardItemRoute, type ItemRouteContext } from '@/lib/api/itemRoute'
import { runCommand } from '@/lib/api/runCommand'
import { assignNoteNumber } from '@/lib/commands/noteCommands'
import { apiOk } from '@/lib/route/respond'

export async function POST(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  const { itemId } = guard
  return runCommand('番号の割り当て', async () => {
    const item = await assignNoteNumber(itemId)
    return apiOk({ item: toItemDto(item) })
  })
}
