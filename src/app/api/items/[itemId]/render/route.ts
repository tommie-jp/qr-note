// ノートの描画材料のうち、端末で作れないもの (表・健康・添付量)。docs/123 §1-3。
// ?only=bytes は添付量だけ (表・健康のフェンスを持たないノート)
import type { NextResponse } from 'next/server'
import { guardItemRoute, type ItemRouteContext } from '@/lib/api/itemRoute'
import { loadNoteRender } from '@/lib/api/notePayload'
import { getItem } from '@/lib/items/read'
import { apiOk } from '@/lib/route/respond'

export async function GET(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context)
  if (!guard.ok) {
    return guard.response
  }
  const item = await getItem(guard.itemId)
  const bytesOnly = new URL(request.url).searchParams.get('only') === 'bytes'
  return apiOk(await loadNoteRender(item?.memo ?? '', { bytesOnly }))
}
