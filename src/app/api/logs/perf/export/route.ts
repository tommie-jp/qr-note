import { NextResponse } from 'next/server'
import { formatPerfLinesForCopy } from '@/app/logs/formatLogsForCopy'
import { recentPerfLines } from '@/lib/logging/buffer'
import { perfExportOwner } from '@/lib/logging/perfExportToken'
import { denyIfDemoMode } from '@/lib/route/guard'
import { apiFail } from '@/lib/route/respond'

// 計測行を手元のスクリプトへ渡す口 (docs/120-計測テスト自動化計画.md §3)。
//
// **ログインではなく取得鍵で通す。** セッション Cookie を持たない
// scripts/fetchPerfLog.sh から読むため。proxy は GET だけ素通しし
// (auth/publicPaths.ts の isSelfGuardedPath)、照合はここでやる。
// 返すのは /logs?perf=1 の「コピー」と同じ形の素のテキスト。
//
// 401 の理由は分けない (鍵が無い・形が違う・発行されていない)。どれでも
// 返事を同じにして、手探りの手掛かりを渡さない
const BEARER = /^Bearer (\S+)$/

//
// デモの判定は鍵の照合の**後**。先に置くと、鍵を持たない人にも「デモかどうか」を
// 教えることになる (デモでは鍵を発行できないので、照合は必ず 401 で終わる)
export async function GET(request: Request): Promise<NextResponse> {
  const token = BEARER.exec(request.headers.get('Authorization') ?? '')?.[1]
  const owner = token === undefined ? null : await perfExportOwner(token)
  if (owner === null) {
    return apiFail('取得鍵が違います', 401)
  }

  const demoDenied = denyIfDemoMode()
  if (demoDenied) {
    return demoDenied
  }

  return new NextResponse(`${formatPerfLinesForCopy(recentPerfLines())}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
