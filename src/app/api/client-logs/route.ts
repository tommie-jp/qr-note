import type { NextResponse } from 'next/server'
import { deviceLabel, parseClientLogPayload } from '@/lib/clientLogPayload'
import { pushBrowserLogs } from '@/lib/logBuffer'
import { guardRequest } from '@/lib/route/guard'
import { apiFail, apiOk } from '@/lib/route/respond'

// JSON にならない本文も、形の違う本文も同じ文言で断る
const BAD_PAYLOAD = 'ログの形式が不正です'

// ブラウザで起きた失敗を受け取る (docs/30-ブラウザログ計画.md §1)。
// 控えは /logs がサーバのログと混ぜて出す。
//
// 門番は他の口と同じ二段 (route/guard.ts)。proxy.ts も未ログインの /api/* を
// 401 にするが、それは楽観的な検査であって唯一の砦にはしない。
// 同一サイトの検査も要る — 開けっ放しにすると、第三者のページから
// ログイン済みのブラウザを使ってバッファを埋め、本物の警告を押し流せる。
export async function POST(request: Request): Promise<NextResponse> {
  // デモでは /logs を閉じる (docs/38 §4)。共有アカウントでは他の訪問者の
  // 操作痕が見えるため、転送も受けない (ClientLogCapture も layout で外す)
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  // 本文の検証は parseClientLogPayload に持たせる (送る側と同じ定義を見る)。
  // JSON にすらならない本文もここで断つ — 投げて 500 にすると、
  // 「ログを送れない」がサーバのエラーログを埋める本末転倒になる
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiFail(BAD_PAYLOAD, 400)
  }

  const items = parseClientLogPayload(body)
  if (items === null) {
    return apiFail(BAD_PAYLOAD, 400)
  }

  pushBrowserLogs(items, deviceLabel(request.headers.get('user-agent')))

  // 送りっぱなしで良い口なので中身は返さない (Beacon は応答を読めない)
  return apiOk(null)
}
