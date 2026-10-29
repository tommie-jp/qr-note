// /api/items/:itemId 系の口が共有する前置き (docs/123 §1-1)。
//
// 門番 → itemId の形の検査、をいつも同じ順で通す。形の悪い id は 400 で
// 断る (未登録の id は 200 の null。QR シールを先に貼っておける作り)
import 'server-only'
import type { NextResponse } from 'next/server'
import { guardRequest, type GuardOptions } from '@/lib/route/guard'
import { BAD_REQUEST_MESSAGE } from '@/lib/route/parse'
import { apiFail } from '@/lib/route/respond'
import { isValidItemId } from '@/lib/validation'

export interface ItemRouteContext {
  params: Promise<{ itemId: string }>
}

export type ItemRouteGuard =
  | { readonly ok: true; readonly user: string; readonly itemId: string }
  | { readonly ok: false; readonly response: NextResponse }

export async function guardItemRoute(
  request: Request,
  { params }: ItemRouteContext,
  options: GuardOptions = { demo: 'allow' },
): Promise<ItemRouteGuard> {
  const guard = await guardRequest(request, options)
  if (!guard.ok) {
    return guard
  }
  const { itemId } = await params
  if (!isValidItemId(itemId)) {
    return { ok: false, response: apiFail(BAD_REQUEST_MESSAGE, 400) }
  }
  return { ok: true, user: guard.user, itemId }
}
