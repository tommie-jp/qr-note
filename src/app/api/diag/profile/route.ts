import { readFile } from 'node:fs/promises'
import { NextResponse } from 'next/server'
import { isAdminUser } from '@/lib/auth/admin'
import { profilePath } from '@/lib/diag/benchStore'
import { guardRequest } from '@/lib/route/guard'
import { apiFail } from '@/lib/route/respond'

// 回路フェンス解析の CPU プロファイルを渡す (docs/121 §3-4)。
// Chrome DevTools の Performance (Load profile) か speedscope で開く。
// 管理者だけ (ベンチマークの画面と同じ)。デモは断る
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  if (!isAdminUser(guard.user)) {
    return apiFail('管理者だけが取得できます', 403)
  }
  let body: Buffer
  try {
    body = await readFile(profilePath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return apiFail('まだ計測していません', 404)
    }
    throw error
  }
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="qr-benchmark-parse.cpuprofile"',
      'Cache-Control': 'no-store',
    },
  })
}
