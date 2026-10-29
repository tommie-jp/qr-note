// 並び順の cookie (docs/123 §2-1)。一覧用とゴミ箱用の 2 つ
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { preferenceCookie } from '@/lib/prefs/preferenceCookie'
import { SORT_COOKIE, SORT_COOKIE_MAX_AGE, TRASH_SORT_COOKIE } from '@/lib/prefs/sortMode'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'
import { SORTS, TRASH_SORTS, type Sort, type TrashSort } from '@/lib/validation'

export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  const body = await parseJsonBody(request, ({ sort, scope }) => {
    if (scope === 'trash') {
      return TRASH_SORTS.includes(sort as TrashSort) ? { sort: sort as TrashSort, trash: true } : null
    }
    return SORTS.includes(sort as Sort) ? { sort: sort as Sort, trash: false } : null
  })
  if (!body.ok) {
    return body.response
  }
  const store = await cookies()
  store.set(
    body.value.trash ? TRASH_SORT_COOKIE : SORT_COOKIE,
    body.value.sort,
    preferenceCookie(SORT_COOKIE_MAX_AGE),
  )
  return apiOk({ sort: body.value.sort })
}
