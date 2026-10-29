// 検索の口 (docs/123 §1-3)。N ページ目の 20 件と、1 ページ目だけ付属情報を返す。
//
// 読むだけの口でも guardRequest を通す (ログイン・クロスサイト)。ノート本文が
// まとめて出るので、第三者のページから読まれると被害が大きい (docs/18 §9)
import type { NextResponse } from 'next/server'
import { loadSearchPayload } from '@/lib/api/searchPayload'
import { parseListQuery } from '@/lib/api/searchParams'
import { formatServerTiming } from '@/lib/logging/perfLine'
import { reportServerLine } from '@/lib/logging/perfServer'
import { guardRequest } from '@/lib/route/guard'
import { BAD_REQUEST_MESSAGE } from '@/lib/route/parse'
import { apiOkPagedGzip } from '@/lib/route/compress'
import { apiFail } from '@/lib/route/respond'

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  const input = parseListQuery(new URL(request.url))
  if (input === null) {
    return apiFail(BAD_REQUEST_MESSAGE, 400)
  }
  const { payload, meta, perf } = await loadSearchPayload(input)
  // 回路図サムネの多い検索は数百 KB になるので圧縮して返す (docs/123 §11-6)
  const res = await apiOkPagedGzip(payload, meta, request)
  if (perf !== null) {
    res.headers.set('Server-Timing', formatServerTiming(perf.phases))
    reportServerLine(
      '検索/API',
      [
        ['page', meta.page],
        ['件数', `${payload.items.length}/${meta.total}`],
      ],
      perf,
    )
  }
  return res
}
