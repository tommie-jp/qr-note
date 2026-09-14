import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isProductionEnv } from '@/lib/appEnv'
import { LOGIN_REQUIRED_PATH } from '@/lib/auth/loginRedirect'
import {
  decideWithoutSession,
  decideWithSession,
  type ProxyDecision,
  type ProxyRequest,
  type ProxySession,
} from '@/lib/auth/proxyDecision'
import { resolveSession } from '@/lib/auth/requestAuth'
import { apiFail } from '@/lib/route/respond'
import { renewSession } from '@/lib/auth/sessionStore'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth/sessionToken'

// ログインの門番 (docs/18-ログイン計画.md)。
//
// Next.js 16 で middleware は proxy に改称された (機能は同じ)。ファイル名は
// proxy.ts でなければ読まれない。また 16 からは Node.js ランタイムが既定
// なので、ここで bcrypt を回せる (旧 middleware の Edge ランタイムでは無理だった)。
//
// なぜ「ここ」なのか: 認証をエッジ (nginx / Caddy) から外したのは、ログイン
// しなくてもヘッダの帯を出すため。外した以上 401 を返す誰かが要る。ここに
// 置けば、新しいページを足したとき黙って公開されることがない
// (公開したいものだけを auth/publicPaths.ts に明記する = 既定が閉じている)。
//
// ただしこれは Next.js の言う「楽観的な検査」であって唯一の砦ではない
// (01-app/02-guides/authentication.md)。データに触る入口では auth/session.ts の
// requireUser() がもう一度確かめる。
//
// 分岐の判定は lib/auth/proxyDecision.ts が持つ。ここはリクエストから入力を集め、
// 判定を NextResponse に写すだけ (docs/93-リファクタリング計画.md §4-9)

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const facts: ProxyRequest = {
    host: request.headers.get('host'),
    url: request.nextUrl,
    method: request.method,
    isProduction: isProductionEnv(),
  }
  // セッションは decideWithoutSession で決まらなかったときだけ引く
  const decision =
    decideWithoutSession(facts) ??
    decideWithSession(facts, await lookupSession(request), new Date())
  return respond(request, decision)
}

async function lookupSession(request: NextRequest): Promise<ProxySession | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null
  const session = await resolveSession(token)
  return session !== null && token !== null
    ? { token, expiresAt: session.expiresAt }
    : null
}

async function respond(request: NextRequest, decision: ProxyDecision): Promise<NextResponse> {
  switch (decision.kind) {
    case 'loopback-redirect':
      // 307 = 一時的 + メソッドを保つ。308 だとブラウザに恒久的に覚えられ、
      // あとで挙動を変えたくなったときに古い転送が残る
      return NextResponse.redirect(decision.location, 307)
    case 'pass':
      return NextResponse.next()
    case 'pass-noindex':
      return denyIndexing(NextResponse.next())
    case 'pass-with-renewal':
      return withRenewedSession(decision.token)
    case 'rewrite-login-required': {
      const notice = NextResponse.rewrite(new URL(LOGIN_REQUIRED_PATH, request.nextUrl))
      return decision.noindex ? denyIndexing(notice) : notice
    }
    case 'unauthorized':
      return apiFail('ログインが必要です', 401)
  }
}

// 検索エンジンに載せない印 (どこに付けるかの理由は auth/proxyDecision.ts)
function denyIndexing(response: NextResponse): NextResponse {
  response.headers.set('X-Robots-Tag', 'noindex')
  return response
}

// セッションの期限を延ばす (docs/29-パスキー計画.md §4)。延ばす頃合いの判定は
// auth/proxyDecision.ts が済ませている。
//
// **延長をここでしか行わないのは、Cookie を貼り直せる場所がここだけだから**。
// Server Component (auth/session.ts の currentUser) からは Cookie を書けない。
//
// 失敗しても素通しする。延長は「90 日が 90 日に戻らなかった」だけの話で、
// そのためにログイン済みの人を締め出す理由はない
async function withRenewedSession(token: string): Promise<NextResponse> {
  const response = NextResponse.next()

  try {
    await renewSession(token)
  } catch (error) {
    console.error('セッションの期限延長に失敗しました', error)
    return response
  }

  // DB を延ばしただけでは足りない。Cookie の Max-Age も貼り直さないと、
  // ブラウザ側が先に捨ててしまう
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions())
  return response
}

export const config = {
  // matcher を書かないと _next/static や public/ の中身にまで走り、CSS や JS が
  // 認証に引っかかって画面が崩れる。ここで挙げるのは「素通しするもの」の否定。
  //
  // _next/static … ビルド成果物 (JS/CSS)。中身はどのみち誰でも読める
  // _next/image  … 画像最適化
  // favicon.ico  … ブラウザが資格情報なしで取りに行く
  // api/import   … ノートの取り込み (docs/28-エクスポート計画.md §3)。
  //                **proxy を通るルートは Next.js が本文をメモリへ丸ごと複製
  //                する** (proxy と route の両方で読めるようにするため。上限は
  //                experimental.proxyClientMaxBodySize = 31MB。既定は 10MB
  //                だが、動画の 30MB が千切れるので next.config.ts で上げた)。
  //                この口は 500MB を流し読みで受ける設計なので、複製されると
  //                そこで千切れる (上限を 500MB まで上げると今度は 500MB が
  //                メモリに載り、RAM 2GB の本番が落ちる)。proxy から外して
  //                素通しし、認証は route handler 側の guardRequest に
  //                任せる — もともとここは楽観的検査で、データに触る入口が正
  //                (冒頭のコメント)。実際に本番で「10MB で切られて ZIP が
  //                壊れて見える」を踏んだ
  //
  // 画面と API はここに残す = 既定で門番を通る。ログイン不要なものは
  // auth/publicPaths.ts に明記する
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/import$).*)'],
}
