// タグの一覧 (件数つき)。検索窓の補完とフォルダーペインが使う (docs/123 §1-3)
import type { NextResponse } from 'next/server'
import { listTags } from '@/lib/items/read'
import { guardRequest } from '@/lib/route/guard'
import { apiOk } from '@/lib/route/respond'

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  return apiOk({ tags: await listTags() })
}
