import type { NextResponse } from 'next/server'
import { loadOfflineSyncPayload } from '@/lib/offline/syncItems'
import { guardRequest } from '@/lib/route/guard'
import { apiOk } from '@/lib/route/respond'
import { startPhases } from '@/lib/logging/phase'
import { formatServerTiming, perfMB } from '@/lib/logging/perfLine'
import { reportServerLine } from '@/lib/logging/perfServer'
import { isPerfLogEnabled } from '@/lib/logging/perfSwitch'

// オフライン用にノートをまるごと持ち出す口 (docs/65-オフライン対応計画.md §1)。
//
// **ここは 401 を返す口である**ことが Service Worker との関係で効く。画面の
// 取得 (proxy.ts) は未ログインでも 200 で案内へ差し替わるので、同じ流儀で
// この口を作ると、キャッシュにはログイン案内が「ノート」として沈む。
// route/guard.ts の門番を通すことで、未ログインは必ず 401 = 同期の失敗になる。
//
// クロスサイトも断る。ノート全文がまとめて出る口なので、第三者のページから
// 読まれると被害が大きい (docs/18-ログイン計画.md §9)。
//
// デモでも断る。ここは /api/export と同じ「全データを 1 応答で持ち出す口」で、
// 共有アカウントのデモに開けておく理由がない (docs/39-デモ公開計画.md §3)。
// chrome/AppSideEffects.tsx が !isDemo で仕掛けないようにもしてあるが、**旗の欠落に頼らない**
// のが route/guard.ts の流儀 — 画面を出さないことと、口を閉じることは別の話。
//
// 応答は apiOk が no-store を付ける。中間キャッシュに持たれると、別の端末で
// 足したノートがいつまでも届かない。
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  if (!isPerfLogEnabled()) {
    return apiOk(await loadOfflineSyncPayload())
  }
  return measuredResponse()
}

// 速度計測中の応答 (docs/119 §2-3)。段階は ASCII の名前で測り、そのまま
// Server-Timing に載せる (ブラウザの行がそこから写す)。
//
// json … NextResponse.json は本文を作るときに同期で JSON.stringify するので、
// apiOk の呼び出しを測ればそれが文字列化の時間になる。
// rss / heap は応答を組んだ直後 = 10MB の文字列を抱えている山で読む
// (vps1 は 2GB。docs/118 §2-2 の gzip を足したときの余裕をここで見る)
async function measuredResponse(): Promise<NextResponse> {
  const t = startPhases(true)
  const payload = await t.time('db', () => loadOfflineSyncPayload())
  const res = await t.time('json', () => apiOk(payload))
  const perf = t.done()
  const memory = process.memoryUsage()
  if (perf !== null) {
    res.headers.set('Server-Timing', formatServerTiming(perf.phases))
  }
  reportServerLine(
    '同期/サーバ',
    [
      ['件数', payload.items.length],
      ['回路', payload.circuits.length],
      ['rss', perfMB(memory.rss)],
      ['heap', perfMB(memory.heapUsed)],
    ],
    perf,
  )
  return res
}
