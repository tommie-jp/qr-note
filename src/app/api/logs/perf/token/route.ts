import type { NextResponse } from 'next/server'
import { issuePerfExportToken } from '@/lib/logging/perfExportToken'
import { guardRequest } from '@/lib/route/guard'
import { apiOk } from '@/lib/route/respond'

// 計測ログの取得鍵を発行する (docs/120-計測テスト自動化計画.md §3)。
// 門番は切替の口 (api/logs/perf) と同じ。発行し直すと前の鍵は使えなくなる。
// 鍵はこの応答で 1 度だけ返し、サーバには hash しか残らない
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  const token = await issuePerfExportToken(guard.user)
  return apiOk({ token })
}
