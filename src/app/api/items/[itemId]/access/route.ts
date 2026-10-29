// ノートを開いたことを記録する (docs/37)。画面のマウント後に端末が呼ぶ
// (描画で記録すると先読みだけで「見た」ことになる)。失敗しても 200
import type { NextResponse } from 'next/server'
import { guardItemRoute, type ItemRouteContext } from '@/lib/api/itemRoute'
import { recordAccess } from '@/lib/commands/noteCommands'
import { apiOk } from '@/lib/route/respond'

export async function POST(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context)
  if (!guard.ok) {
    return guard.response
  }
  await recordAccess(guard.itemId)
  return apiOk({})
}
