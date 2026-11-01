import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyBasicAuthUser } from '@/lib/auth/basicAuth'
import { LOGIN_RETRY_AFTER_SECONDS, LoginBusyError } from '@/lib/auth/loginGate'
import { safeNextPath } from '@/lib/auth/loginRedirect'
import { issueSession } from '@/lib/auth/sessionStore'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth/sessionToken'
import { loginCancelledPage } from './cancelledPage'

// ログインの口 (docs/18-ログイン計画.md)。
//
// 資格情報がなければ 401 + WWW-Authenticate を返し、ブラウザに認証ダイアログを
// 出させる。ダイアログを出す手段はこれしかない — だからログインは
// 「ここへ普通に画面遷移する」形にしてある (fetch や router.push では
// ダイアログが出ない。components/auth/LoginButton.tsx のコメントも参照)。
//
// **Authorization ヘッダを認証として見てよいのはこの route だけ**
// (docs/18 §11)。通ったらパスキーと同じセッションを発行し、以後の
// リクエストは Cookie だけで通す。
//
// こうしないとログアウトが成立しない。realm の保護空間はこの URL の
// ディレクトリ = '/' 配下なので、一度ここを通るとブラウザはサイト全体へ
// 資格情報を自分から送り続ける (RFC 7617)。それを毎リクエスト認証として
// 受け付けている限り、サーバが何を消しても次のリクエストで復活してしまう。

export async function GET(request: NextRequest): Promise<NextResponse> {
  // next は外から来る値。素通しすると他所へ運ぶ踏み台になるので必ず検算する。
  // 401 のボディにも載せるので、認証の成否より先に出しておく
  const next = safeNextPath(request.nextUrl.searchParams.get('next'))

  let user: string | null
  try {
    user = await verifyBasicAuthUser(request.headers.get('authorization'))
  } catch (error) {
    if (!(error instanceof LoginBusyError)) {
      throw error
    }
    return loginBusyResponse()
  }

  if (user === null) {
    // ボディが人の目に触れるのはダイアログをキャンセルしたときだけ。
    // そのとき行き止まりにしないための HTML (cancelledPage.ts)
    return new NextResponse(loginCancelledPage(next), {
      status: 401,
      headers: {
        // charset="UTF-8" … ユーザー名に非 ASCII を使えるようにする (RFC 7617)
        //
        // realm が旧名のままなのはわざと。ブラウザはこの文字列を保存済み資格情報の
        // 鍵 (protection space) にしているので、変えると全端末で入れ直しになる。
        // 今のブラウザは realm をダイアログに出さないため、変える利点の方が無い
        'WWW-Authenticate': 'Basic realm="qr-search", charset="UTF-8"',
        'Content-Type': 'text/html; charset=utf-8',
        // 401 も含めて誰にも持たせない。前に nginx が居るため明示する
        'Cache-Control': 'no-store',
      },
    })
  }

  // 資格情報が正しいと確かめたこの 1 回だけ、セッションを発行する。
  // 以後 auth/requestAuth.ts はこの Cookie だけを見る
  const session = await issueSession(user)

  // Location は相対パスのまま返す (RFC 7231 が認めている)。
  // NextResponse.redirect() は絶対 URL を要求するため使わない — 絶対 URL に
  // すると、アプリが自分のホスト名を組み立てることになり、実測で
  // `http://0.0.0.0:3100/...` が出た。本番はアプリの前に nginx が居るので、
  // アプリが見ているホストとスキーム (http, コンテナの内側) は、ブラウザが
  // 居る場所 (https://qr.tommie.jp) と一致しない。相対なら組み立てずに済む
  const response = new NextResponse(null, {
    // 303 = 「GET で取り直せ」。307 だと POST が来たとき POST のまま
    // 転送されてしまう (ここは GET しか受けないが、意図を明示しておく)
    status: 303,
    headers: {
      Location: next,
      'Cache-Control': 'no-store',
    },
  })
  response.cookies.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions())
  return response
}

// 照合の門 (auth/loginGate.ts) が満杯のときの応答。bcrypt を回さずに断る。
//
// 401 ではなく 429 にするのが要点。401 を返すとブラウザが資格情報を捨てて
// ダイアログを出し直し、本人には「パスワードを間違えた」ように見える。
// WWW-Authenticate を付けないので、ブラウザは覚えた資格情報を保ったまま
// この本文を表示する。Retry-After は門が捌ける目安
function loginBusyResponse(): NextResponse {
  return new NextResponse(
    'ログインが混み合っています。少し待ってから、もう一度お試しください。',
    {
      status: 429,
      headers: {
        'Retry-After': String(LOGIN_RETRY_AFTER_SECONDS),
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  )
}
