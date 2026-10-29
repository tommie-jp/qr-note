// 一覧の中の前後のノート (docs/123 §1-3)。検索語が無ければ前後とも null。
// 並び順は ?sort= → cookie → 既定 (itemListContext.ts と同じ解決)
import type { NextResponse } from 'next/server'
import { guardItemRoute, type ItemRouteContext } from '@/lib/api/itemRoute'
import { MAX_QUERY_LENGTH } from '@/lib/api/searchParams'
import { findItemNeighbors, resolveListParams } from '@/lib/prefs/itemListContext'
import { BAD_REQUEST_MESSAGE } from '@/lib/route/parse'
import { apiFail, apiOk } from '@/lib/route/respond'

export async function GET(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context)
  if (!guard.ok) {
    return guard.response
  }
  const url = new URL(request.url)
  const q = url.searchParams.get('q') ?? ''
  if (q.length > MAX_QUERY_LENGTH) {
    return apiFail(BAD_REQUEST_MESSAGE, 400)
  }
  const params = await resolveListParams(q, url.searchParams.get('sort') ?? undefined)
  const neighbors = await findItemNeighbors(guard.itemId, params)
  return apiOk({ ...neighbors, query: params.query, sort: params.sort })
}
