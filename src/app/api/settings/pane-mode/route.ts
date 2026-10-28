import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { PANE_MODE_COOKIE, PANE_MODE_COOKIE_MAX_AGE, PANE_MODES, type PaneMode } from '@/lib/prefs/paneMode'
import { preferenceCookie } from '@/lib/prefs/preferenceCookie'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'

// 検索画面のペイン構成 (3 → 2 → 1) を cookie に書く口 (docs/86 §4-18)。
//
// **サーバアクションにしない** (選択色の口 api/settings/row-tint と同じ判断)。
// アクションはその場のページを描き直して応答に載せる。検索画面では一覧 20 件の
// プレビューとノートを丸ごと組み直すので、1 → 3 で 1.2MB になった。しかも
// アクションが終わるまで、次に押したノートへの遷移が後ろに並んで待たされる。
// 釦は押した瞬間に画面を組み替え (pendingPaneMode)、ここで cookie だけ書いてから
// router.refresh() でフォルダーと先頭ノートを埋める。
//
// **デモでも許す。** 値は端末の cookie に載るだけで、共有アカウントの誰にも
// 効かない (選択色はアカウントの DB に載るので断っている)。
// ログインは要る — 釦はログイン中のヘッダーにしか出ない
export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }

  // **知らない値は畳まず断る。** 既定 (2) へ寄せると、送り手は押した構成に
  // なったと思い込んだまま画面と cookie が食い違う
  const mode = await parseJsonBody(request, (body) => {
    const { mode: value } = body
    return PANE_MODES.includes(value as PaneMode) ? (value as PaneMode) : null
  })
  if (!mode.ok) {
    return mode.response
  }

  const store = await cookies()
  store.set(PANE_MODE_COOKIE, mode.value, preferenceCookie(PANE_MODE_COOKIE_MAX_AGE))
  return apiOk({ mode: mode.value })
}
