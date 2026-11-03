// GET /api/calendar?q=…&month=YYYY-MM (docs/126 §1-3)。
// src/app/api/calendar/route.ts はこれを再輸出するだけ (モジュールの境界)。
//
// 読むだけの口でも guardRequest を通す (ログイン・クロスサイト)。予定の題名が
// まとめて出るので、一覧の口と同じ扱い
import type { NextResponse } from 'next/server'
import { MAX_QUERY_LENGTH } from '@/lib/api/searchParams'
import { guardRequest } from '@/lib/route/guard'
import { BAD_REQUEST_MESSAGE } from '@/lib/route/parse'
import { apiFail, apiOk } from '@/lib/route/respond'
import { isMonth } from '../event/monthLayout'
import { loadMonthEvents } from './calendarQuery'

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  const params = new URL(request.url).searchParams
  const query = (params.get('q') ?? '').trim()
  const month = params.get('month') ?? ''
  if (query.length > MAX_QUERY_LENGTH || !isMonth(month)) {
    return apiFail(BAD_REQUEST_MESSAGE, 400)
  }
  return apiOk(await loadMonthEvents(query, month))
}
