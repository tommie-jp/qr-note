import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { denyCrossSite } from '@/lib/route/guard'
import { apiOk } from '@/lib/route/respond'
import { destroySession } from '@/lib/auth/sessionStore'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth/sessionToken'

// ログアウト (docs/29-パスキー計画.md §4)。
//
// docs/18 §3 の「ログアウトはない」はここで解消する。Basic 認証では
// 資格情報を握っているのがブラウザで、サーバから忘れさせる手段がなかった。
// セッションなら行を消せばその端末は入れなくなる。
//
// **ログイン検査はしない**。既に切れているセッションで押されることがあり、
// そこで 401 を返すと「ログアウトできないログイン状態」になる。
// 誰が押しても結果は「その Cookie を無効にする」だけで、他人には影響しない。
export async function POST(request: Request): Promise<NextResponse> {
  const denied = denyCrossSite(request)
  if (denied) {
    return denied
  }

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null

  // DB の行を消す。ここを飛ばして Cookie だけ消すと、盗まれたトークンが
  // 90 日間有効なまま残る
  await destroySession(token)

  const response = apiOk({ loggedOut: true })
  // maxAge を 0 にして即時失効させる。属性 (path など) は発行時と
  // 揃えること — 違うと別の Cookie とみなされ、元の Cookie が消えない
  response.cookies.set(SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0 })
  return response
}
