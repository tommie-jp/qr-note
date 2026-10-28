import type { NextResponse } from 'next/server'
import { setPerfLogEnabled } from '@/lib/logging/perfSwitch'
import { guardRequest } from '@/lib/route/guard'
import { apiFail, apiOk } from '@/lib/route/respond'

const BAD_PAYLOAD = '計測の切替の形式が不正です'

// 速度計測の切替 (docs/119-速度計測ログ計画.md §1-4)。本文は { enabled: boolean }。
// 門番は消去の口 (api/logs/clear) と同じ二段で、デモでは断る (/logs ごと閉じている)。
//
// 切り替えた値はプロセスの中に持つので、全端末に効く。ブラウザ側の観測は
// root layout が描くかどうかで決まるため、各端末は**読み込み直して**から効く
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiFail(BAD_PAYLOAD, 400)
  }
  const enabled = (body as { enabled?: unknown } | null)?.enabled
  if (typeof enabled !== 'boolean') {
    return apiFail(BAD_PAYLOAD, 400)
  }

  setPerfLogEnabled(enabled)
  return apiOk({ enabled })
}
