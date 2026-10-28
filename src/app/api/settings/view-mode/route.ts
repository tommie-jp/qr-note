import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { preferenceCookie } from '@/lib/prefs/preferenceCookie'
import { VIEW_MODE_COOKIE, VIEW_MODE_COOKIE_MAX_AGE, VIEW_MODES, type ViewMode } from '@/lib/prefs/viewMode'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'

// 検索結果の表示モード (小・中・大・画像) を cookie に書く口 (docs/118 §10 案 B)。
//
// **サーバアクションにしない** (ペイン構成の口 api/settings/pane-mode と同じ判断)。
// アクションは描き直した一覧を応答に載せて返すので、押してから見た目が変わる
// までに回線の往復を必ず 1 回待つ (本番で 150〜270ms)。釦は押した瞬間に一覧を
// 新しいモードで描き替え (pendingViewMode)、ここで cookie だけ書いてから
// router.refresh() で足りない材料 (カードの本文プレビュー・数式) を埋める。
// JS が動かないときの受け皿として、Server Action (setViewModeAction) は残す。
//
// **デモでも許す。** 値は端末の cookie に載るだけ (ペイン構成と同じ)
export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }

  // **知らない値は畳まず断る。** 既定 (小) へ寄せると、送り手は押したモードに
  // なったと思い込んだまま画面と cookie が食い違う
  const mode = await parseJsonBody(request, (body) => {
    const { mode: value } = body
    return VIEW_MODES.includes(value as ViewMode) ? (value as ViewMode) : null
  })
  if (!mode.ok) {
    return mode.response
  }

  const store = await cookies()
  store.set(VIEW_MODE_COOKIE, mode.value, preferenceCookie(VIEW_MODE_COOKIE_MAX_AGE))
  return apiOk({ mode: mode.value })
}
