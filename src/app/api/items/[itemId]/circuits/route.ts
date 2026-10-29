// ノートの回路図を描き終えてから返す (docs/123 §1-3)。キャッシュ済みなら数 ms、
// 未描画なら 1 枚 1〜3 秒。端末は届くまで図の場所にだけ「準備中」を出す
import type { NextResponse } from 'next/server'
import { guardItemRoute, type ItemRouteContext } from '@/lib/api/itemRoute'
import { loadNoteCircuits } from '@/lib/api/notePayload'
import { getItem } from '@/lib/items/read'
import { apiOk } from '@/lib/route/respond'

export async function GET(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context)
  if (!guard.ok) {
    return guard.response
  }
  const item = await getItem(guard.itemId)
  return apiOk(await loadNoteCircuits(item?.memo ?? ''))
}
