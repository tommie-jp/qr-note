import { NextResponse } from 'next/server'
import { loadOfflineSyncPayload } from '@/lib/offline/syncItems'
import { loadSyncEtag } from '@/lib/offline/syncVersion'
import { guardRequest } from '@/lib/route/guard'
import { apiOkGzip } from '@/lib/route/compress'
import { startPhases, type PerfPhases } from '@/lib/logging/phase'
import type { OfflineSyncPayload } from '@/lib/offline/item'
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
// 応答は no-store。中間キャッシュに持たれると、別の端末で足したノートが
// いつまでも届かない。
//
// 転送を軽くする 2 段 (docs/118 §4):
//   ETag … 本文を組む前に安い問い合わせ 1 本で版を決め (syncVersion.ts)、端末が
//          If-None-Match で同じ版を送ってきたら 304 で本文を送らない
//   gzip … 版が変わっていれば本文を gzip で返す (11MB → 約 2.3MB)。Next も
//          nginx も Route Handler の JSON を圧縮しない (route/compress.ts)
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  const t = startPhases(isPerfLogEnabled())
  const etag = await t.time('etag', () => loadSyncEtag())
  if (request.headers.get('if-none-match') === etag) {
    const res = new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' },
    })
    return finish(res, t.done(), null)
  }
  const payload = await t.time('db', () => loadOfflineSyncPayload())
  // 端末は写しに etag を残し、次の同期で If-None-Match に載せる (offline/sync.ts)。
  // json … JSON.stringify と gzip を合わせた時間
  const res = await t.time('json', () => apiOkGzip({ ...payload, etag }, request, { ETag: etag }))
  return finish(res, t.done(), payload)
}

// 速度計測中の Server-Timing と行 (docs/119 §2-3)。計測していなければ (perf が
// null) 何もしない。rss / heap は応答を組んだ直後 = 11MB の文字列と圧縮後の
// 2.3MB を抱えている山で読む (vps1 の余裕を見る)
function finish(
  res: NextResponse,
  perf: PerfPhases | null,
  payload: OfflineSyncPayload | null,
): NextResponse {
  if (perf === null) {
    return res
  }
  res.headers.set('Server-Timing', formatServerTiming(perf.phases))
  const memory = process.memoryUsage()
  reportServerLine(
    '同期/サーバ',
    [
      ['結果', res.status],
      ['件数', payload?.items.length ?? 0],
      ['回路', payload?.circuits.length ?? 0],
      ['rss', perfMB(memory.rss)],
      ['heap', perfMB(memory.heapUsed)],
    ],
    perf,
  )
  return res
}
