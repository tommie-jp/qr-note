import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { apiFail, apiOk } from '@/lib/route/respond'
import { deletePasskey } from '@/lib/auth/passkeys'
import { destroyOtherSessions } from '@/lib/auth/sessionStore'
import { SESSION_COOKIE_NAME } from '@/lib/auth/sessionToken'
import { guardRecentLogin } from '@/lib/route/guard'

// 登録済みパスキーを 1 つ消す (docs/29-パスキー計画.md §6, §8)。
//
// **最後の 1 つでも消させる**。パスキーが 0 個になってもパスワード (Basic)
// で入れるので締め出しにならない — それが Basic を残した理由そのもの
// (docs/29 §2)。「最後の 1 つは消せません」という制限を付けると、
// 紛失した端末の鍵を消せなくなるほうが困る。
//
// 門番は「ログインし直して 10 分以内」(guardRecentLogin。2026-11 の監査 M-6)。
// セッションを盗んだ側が正規の鍵を全部消せる口にしない。
//
// **消すのは鍵だけではない。** 鍵を消す動機は「その端末を失くした」で、
// その端末はセッション Cookie も持っている。鍵だけ消しても 90 日のスライディング
// セッションで入り続けられるので、いま使っている端末以外のセッションも一緒に
// 消す (sessionStore.destroyOtherSessions)。他の正規の端末は入り直しになるが、
// 失くした端末を締め出せないほうが困る
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // デモでは登録も削除も閉じる (docs/38 §4。パスキー設定画面ごと落とす)
  const guard = await guardRecentLogin(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  const { id } = await params
  const deleted = await deletePasskey(id)
  if (!deleted) {
    return apiFail('そのパスキーは見つかりませんでした', 404)
  }

  const currentToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null
  const revokedSessions = await destroyOtherSessions(guard.user, currentToken)
  console.info(
    `パスキーを削除しました (user=${guard.user}, id=${id}, 他端末のセッション ${revokedSessions} 件を失効)`,
  )

  return apiOk({ id, revokedSessions })
}
