// リクエストからログインユーザーを取る層 (docs/18-ログイン計画.md)。
//
// proxy.ts の門番だけを防御線にしない。Next.js の文書がはっきり書いているとおり
// (01-app/02-guides/authentication.md)、proxy は「楽観的な検査」であって
// 唯一の砦にしてはいけない。データに触る入口 (Server Action / route handler /
// ページ) では、ここでもう一度確かめる。
//
// 照合そのものは下の層が持つ。ここはリクエストと結びつける役だけ:
//
//   auth/sessionStore.ts … セッションの照合
//   auth/requestAuth.ts  … 判定の正本 (セッション Cookie だけを見る。docs/18 §11)
//
// Authorization ヘッダはここでは読まない。資格情報を検証してよいのは
// app/login/route.ts だけで、あちらが通ったらセッションを発行する。

import { cookies } from 'next/headers'
import { cache } from 'react'
import { resolveUser } from './requestAuth'
import { SESSION_COOKIE_NAME } from './sessionToken'

// React の cache() で 1 レンダリングパスにつき 1 回に畳む。ページと
// そこに置いた各コンポーネントが別々に呼んでも、照合は 1 回で済む
export const currentUser = cache(async (): Promise<string | null> => {
  const cookieStore = await cookies()
  return resolveUser(cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null)
})

// requireUser() が投げる印。通常の経路では proxy.ts が先に止めるため、
// これが飛ぶのは「門番をすり抜けた」ときだけ。握りつぶさず 500 で落とす
// ほうがよい (静かに素通しするより気づける)
export class UnauthorizedError extends Error {
  constructor() {
    super('ログインが必要です')
    this.name = 'UnauthorizedError'
  }
}

// ログイン必須の処理の先頭で呼ぶ。通らなければ投げる
export async function requireUser(): Promise<string> {
  const user = await currentUser()
  if (user === null) {
    throw new UnauthorizedError()
  }
  return user
}
