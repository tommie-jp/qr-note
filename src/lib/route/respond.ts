// API の封筒 ({ success, data, error }) を組み立てる唯一の場所
// (docs/93-リファクタリング計画.md §3-3)。
//
// 封筒の形は /api/* のすべてで揃える (~/.claude の API Response Format にも
// 合わせてある)。route handler も proxy.ts もリテラルを手書きせず、ここを通す。
//
// 既定でどの応答にも Cache-Control: no-store を付ける。チャレンジもセッションも
// 「その 1 回だけ」の値で、nginx やブラウザに持たれると別の誰かに配られうる
// (docs/29-パスキー計画.md §6)。
//
// **next/server だけを読む葉にしておく。** proxy.ts (Next の proxy) からも使うので、
// ここに門番 (セッション・prisma) を混ぜると proxy の束まで引きずり込む

import { NextResponse } from 'next/server'

const NO_STORE = 'no-store'

export interface ApiResponseOptions {
  // 既定は no-store。別の値を付けるのはサムネの代替 404 (画像の口) だけ
  readonly cacheControl?: string
}

export function apiOk<T>(
  data: T,
  status = 200,
  options: ApiResponseOptions = {},
): NextResponse {
  return envelopeResponse({ success: true, data, error: null }, status, options)
}

export function apiFail(
  error: string,
  status: number,
  options: ApiResponseOptions = {},
): NextResponse {
  return envelopeResponse({ success: false, data: null, error }, status, options)
}

// デモで閉じた機能を画面に伝える封筒 (docs/39-デモ公開計画.md §5)。
//
// 失敗の封筒に 5 番目の demoDisabled を足し、HTTP は 200 のまま返す。
// 事前入力 (components/editor/usePrefill.ts / external/prefillSummary.ts) はこの印を見て「デモ版では
// 使えない」と出し分ける — 普通の失敗と同じ形にすると「取得に失敗」に見える
export function apiDemoDisabled(error: string): NextResponse {
  return envelopeResponse(
    { success: false, data: null, error, demoDisabled: true },
    200,
  )
}

function envelopeResponse(
  body: Readonly<Record<string, unknown>>,
  status: number,
  { cacheControl = NO_STORE }: ApiResponseOptions = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': cacheControl },
  })
}
