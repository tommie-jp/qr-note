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
  // 既定は no-store。null なら Cache-Control を付けない
  readonly cacheControl?: string | null
}

// Cache-Control を付けていない応答の目印。
//
// books/[isbn]・products/[jan]・images・images/[name]・images/[name]/rotate・
// import・export の封筒は、封筒の書き手を 1 つにする前から付けていなかった。
// 挙動を変えない整理なので今はそのまま運ぶ。揃えるときはこの名前で探す
export const WITHOUT_CACHE_CONTROL: ApiResponseOptions = { cacheControl: null }

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
    WITHOUT_CACHE_CONTROL,
  )
}

function envelopeResponse(
  body: Readonly<Record<string, unknown>>,
  status: number,
  { cacheControl = NO_STORE }: ApiResponseOptions,
): NextResponse {
  return NextResponse.json(
    body,
    cacheControl === null
      ? { status }
      : { status, headers: { 'Cache-Control': cacheControl } },
  )
}
