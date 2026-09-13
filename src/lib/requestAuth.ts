// 「このリクエストは誰か」を決める唯一の場所
// (docs/18-ログイン計画.md §11, docs/29-パスキー計画.md §4)。
//
// **判定はセッション Cookie だけ。** Authorization ヘッダはここでは見ない。
//
// かつては「Cookie → Basic」の順で両方を試していたが、それだとログアウトが
// 成立しない。Basic 認証の資格情報を握っているのはブラウザで、一度 /login を
// 通すと以後**すべてのリクエストにヘッダを自動で付け直す** (RFC 7617)。
// サーバがセッションを消しても Cookie を消しても、次のリクエストのヘッダで
// 即座にログイン済みへ戻ってしまう。
//
// そこで資格情報を検証してよい場所を /login の 1 か所だけに絞り、通ったら
// パスキーと同じセッションを発行することにした (app/login/route.ts)。
// ログイン手段が何であれ「ログイン中 = セッションがある」に揃うので、
// ログアウト = セッション破棄が常に成立する。ブラウザは相変わらずヘッダを
// 送り続けるが、アプリが見ないのでただの無視されるヘッダになる。
//
// proxy.ts と session.ts の両方がここを呼ぶ。判定を二か所に書くと片方だけ
// 直して穴が開くため (publicPaths.ts をエッジから移したときと同じ理由)。
//
// この階層は next/headers に触らない。Cookie の値を渡してもらう側に徹する
// ことで、proxy.ts (リクエスト前) と route handler / Server Component
// (リクエスト中) の両方から呼べる。

import { findActiveSession, type ActiveSession } from './sessionStore'

export type RequestSession = ActiveSession

// expiresAt まで返すのは、proxy の門番 (proxyDecision.ts) が期限の延長を判断するのに要るため。
export async function resolveSession(
  sessionToken: string | null,
): Promise<RequestSession | null> {
  if (sessionToken === null || sessionToken.length === 0) {
    return null
  }

  try {
    return await findActiveSession(sessionToken)
  } catch (error) {
    // 認証できないものは未ログインに倒す (素通しにはしない)。
    // 握りつぶさず必ず記録する — 「ログインできないが原因が分からない」を防ぐ
    console.error('セッションの照合に失敗しました', error)
    return null
  }
}

// 名前だけでよい呼び出し側 (session.ts) 用。
export async function resolveUser(sessionToken: string | null): Promise<string | null> {
  return (await resolveSession(sessionToken))?.userName ?? null
}
