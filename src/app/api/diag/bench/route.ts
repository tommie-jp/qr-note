// ベンチマークの開始と状態 (docs/121)。管理者だけ。速度計測の最中は断る
// (計測どうしが CPU を取り合って、どちらの数字も信用できなくなる)
import os from 'node:os'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { isAdminUser } from '@/lib/auth/admin'
import { startBenchmark } from '@/lib/diag/benchmark'
import { startJob } from '@/lib/diag/benchJob'
import { loadBenchStatus } from '@/lib/diag/benchStatus'
import { pageBenchCookie, runServerBench } from '@/lib/diag/serverBench'
import { isPerfLogEnabled } from '@/lib/logging/perfSwitch'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiFail, apiOk } from '@/lib/route/respond'

async function guardAdmin(request: Request): Promise<NextResponse | null> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  return isAdminUser(guard.user) ? null : apiFail('管理者だけが計測できます', 403)
}

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await guardAdmin(request)
  if (denied) {
    return denied
  }
  return apiOk(await loadBenchStatus())
}

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await guardAdmin(request)
  if (denied) {
    return denied
  }
  const body = await parseJsonBody(request, ({ kind }) =>
    kind === 'cpu' || kind === 'server' ? { kind } : null,
  )
  if (!body.ok) {
    return body.response
  }
  if (isPerfLogEnabled()) {
    return apiFail('速度計測 (計測テスト) が動いています。終わってから押してください', 409)
  }
  if (body.value.kind === 'cpu') {
    startBenchmark(os.cpus().length)
  } else {
    const pageCookie = pageBenchCookie((await cookies()).getAll())
    startJob('server', async () => {
      await runServerBench({ pageCookie })
    })
  }
  return apiOk(await loadBenchStatus())
}
