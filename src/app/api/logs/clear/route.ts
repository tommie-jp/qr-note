import type { NextResponse } from 'next/server'
import { clearLogBuffer, clearPerfLines } from '@/lib/logging/buffer'
import { guardRequest } from '@/lib/route/guard'
import { apiOk } from '@/lib/route/respond'

// ログの控えを消す (docs/30-ブラウザログ計画.md §7)。/logs のクリアボタンが呼ぶ。
// 実機調査で「ここから先が今回の再現」と区切りを付けるための口。
//
// 門番は他の口と同じ二段 (route/guard.ts)。同一サイトの検査も要る —
// 開けっ放しにすると、第三者のページからログイン済みのブラウザを使って
// 調査中の証拠を消せてしまう。
export async function POST(request: Request): Promise<NextResponse> {
  // デモでは /logs を閉じる (docs/38 §4。表示・転送・消去をまとめて塞ぐ)
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  // ?perf=1 は計測行だけを消す (docs/119 §1-3)。調査中の警告と計測の行は
  // 片方を消すともう片方まで消える形にしない
  if (new URL(request.url).searchParams.get('perf') === '1') {
    clearPerfLines()
  } else {
    clearLogBuffer()
  }

  return apiOk(null)
}
