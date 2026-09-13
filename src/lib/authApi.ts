// パスキーの口が共通で使う応答の組み立て (docs/29-パスキー計画.md §6)。
//
// 封筒そのもの (apiOk / apiFail) は route/respond.ts が持つ。

import type { NextResponse } from 'next/server'
import { apiFail } from './route/respond'

// 設定 (WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN) が無いとき。
//
// 501 でも 500 でもなく 503 を選ぶ。「この機能は今この環境では提供して
// いない」であって、壊れているわけでも実装が無いわけでもないため。
// 理由は webauthnConfig() がサーバログへ書く (画面には出さない —
// 未ログインでも叩ける口なので、設定の詳細を外へ漏らさない)。
export function apiPasskeyDisabled(): NextResponse {
  return apiFail('この環境ではパスキーを利用できません', 503)
}

// JSON ボディを受け取る。壊れていれば null。
//
// 外から来る値なので、まず「オブジェクトかどうか」まで確かめてから返す。
// JSON.parse は 'null' や '42' も通してしまう
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return null
    }
    return body as Record<string, unknown>
  } catch {
    return null
  }
}
