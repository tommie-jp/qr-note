import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { destroyOtherSessions } from '@/lib/auth/sessionStore'
import { SESSION_COOKIE_NAME } from '@/lib/auth/sessionToken'
import { guardRecentLogin } from '@/lib/route/guard'
import { apiOk } from '@/lib/route/respond'

// 「他の端末からログアウト」(2026-11 の監査 M-6)。いま使っている端末のセッション
// だけ残し、同じ利用者の他のセッションを全部消す。
//
// それまでセッションを失効させる手段は、その端末でのログアウトと期限切れの掃除
// しか無かった。パスワードを変えても、端末を失くしても、発行済みのセッションは
// 90 日のスライディングで生き続ける。この口がその穴を塞ぐ。
//
// 門番は「ログインし直して 10 分以内」(guardRecentLogin)。セッションを盗んだ側が
// 持ち主を締め出すのに使える口でもあるので、持ち主にはできて盗んだ側にはできない
// 線 (資格情報か認証器を持っているか) で分ける。
//
// パスは /api/auth/ 配下にする — nginx の limit_req (ログインの枠) が掛かる位置
export async function DELETE(request: Request): Promise<NextResponse> {
  const guard = await guardRecentLogin(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  const currentToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null
  const revokedSessions = await destroyOtherSessions(guard.user, currentToken)
  console.info(`他の端末のセッションを失効しました (user=${guard.user}, ${revokedSessions} 件)`)

  return apiOk({ revokedSessions })
}
