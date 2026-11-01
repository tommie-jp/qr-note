import { readBodyBounded } from '@/lib/route/boundedBody'
import { MAX_REPORT_BYTES, summarizeCspReports } from '@/lib/security/cspReport'

// CSP 違反の報告先 (lib/security/csp.ts。2026-11 の監査 M-1)。
//
// CSP を強制で入れると、見落とした読み込み (新しいライブラリ・外部画像の形) は
// 黙って止まる。ブラウザは止めた理由をここへ送ってくるので、サーバログ
// (console.warn → /logs) に 1 行ずつ残して後から気づけるようにする。
//
// **門番は無い。** 未ログインの頁 (公開ノート・ログイン案内) からも飛ぶので、
// auth/publicPaths.ts で公開にしてある。その代わり、本文は 16KB で打ち切り、
// 1 分あたりの件数も絞る (誰でも書ける口でログを押し流せないように)。
// 応答は常に 204 (報告の成否をブラウザに教える意味がない)

const WINDOW_MS = 60 * 1000
const MAX_REPORTS_PER_WINDOW = 60

// 窓とその中の件数。プロセスに 1 つ
let windowStartedAt = 0
let acceptedInWindow = 0

function takeReportSlot(now: number): boolean {
  if (now - windowStartedAt >= WINDOW_MS) {
    windowStartedAt = now
    acceptedInWindow = 0
  }
  if (acceptedInWindow >= MAX_REPORTS_PER_WINDOW) {
    return false
  }
  acceptedInWindow += 1
  return true
}

export async function POST(request: Request): Promise<Response> {
  if (!takeReportSlot(Date.now())) {
    return new Response(null, { status: 429 })
  }
  const body = await readBodyBounded(request, MAX_REPORT_BYTES)
  if (body === null) {
    return new Response(null, { status: 413 })
  }
  for (const line of summarizeCspReports(new TextDecoder().decode(body))) {
    console.warn(`CSP 違反: ${line}`)
  }
  return new Response(null, { status: 204 })
}
