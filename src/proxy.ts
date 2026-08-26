import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isProductionEnv } from '@/lib/appEnv'
import { LOGIN_REQUIRED_PATH } from '@/lib/loginRedirect'
import { loopbackRedirectUrl } from '@/lib/loopbackRedirect'
import { OFFLINE_PATH } from '@/lib/offline/params'
import { isPublicPath, isSelfGuardedPath } from '@/lib/publicPaths'
import { resolveSession } from '@/lib/requestAuth'
import { renewSession } from '@/lib/sessionStore'
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  shouldRenewSession,
} from '@/lib/sessionToken'

// ログインの門番 (docs/18-ログイン計画.md)。
//
// Next.js 16 で middleware は proxy に改称された (機能は同じ)。ファイル名は
// proxy.ts でなければ読まれない。また 16 からは Node.js ランタイムが既定
// なので、ここで bcrypt を回せる (旧 middleware の Edge ランタイムでは無理だった)。
//
// なぜ「ここ」なのか: 認証をエッジ (nginx / Caddy) から外したのは、ログイン
// しなくてもヘッダの帯を出すため。外した以上 401 を返す誰かが要る。ここに
// 置けば、新しいページを足したとき黙って公開されることがない
// (公開したいものだけを publicPaths.ts に明記する = 既定が閉じている)。
//
// ただしこれは Next.js の言う「楽観的な検査」であって唯一の砦ではない
// (01-app/02-guides/authentication.md)。データに触る入口では session.ts の
// requireUser() がもう一度確かめる。

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // ループバック IP で開かれたら localhost へ送り直す (非本番だけ)。
  // パスキーは rpID にドメイン名を要求し 127.0.0.1 では使えないのに、
  // VS Code の「Open in Browser」は必ず 127.0.0.1 を開くため
  // (理由と出典は loopbackRedirect.ts)。
  //
  // ログイン検査より前に置く。未ログインの案内を 127.0.0.1 で見せてから
  // 送り直しても、そこで押したログインが結局使えない
  // 判定は Host ヘッダで行う。request.nextUrl のホストは Next.js が
  // localhost に正規化してしまい、127.0.0.1 で開いても見分けられない
  const loopbackTarget = loopbackRedirectUrl(
    request.headers.get('host'),
    request.nextUrl,
    isProductionEnv(),
  )
  if (loopbackTarget !== null) {
    // 307 = 一時的 + メソッドを保つ。308 だとブラウザに恒久的に覚えられ、
    // あとで挙動を変えたくなったときに古い転送が残る
    return NextResponse.redirect(loopbackTarget, 307)
  }

  if (isPublicPath(pathname)) {
    const response = NextResponse.next()
    return NOINDEX_PUBLIC_PATHS.has(pathname) ? denyIndexing(response) : response
  }

  // 公開かどうかがデータで決まる口 (docs/22-ノート公開計画.md §1)。
  // 公開ノートは未ログインでも読めるが、それを判断できるのは行を見た後なので、
  // ここでは決められない。**読み取りだけ**通し、判定はページ / route handler の
  // isPublicItem() に委ねる。委ね先は publicPaths.ts の一覧に明記されているので、
  // 「新しいページを足したら黙って公開されていた」は起きない。
  //
  // 書き込み (Server Action の POST) をここで通さないのが要点。通すと
  // requireUser() だけが防波堤になり、公開ノートが誰でも書ける口に一歩近づく。
  // 公開は読み取り専用と決めた以上、門番の側でも閉じておく
  if (isSelfGuardedPath(pathname) && isReadRequest(request)) {
    return NextResponse.next()
  }

  // 判定 (セッション Cookie だけを見る) は requestAuth.ts が持つ。
  // ここと session.ts の二か所に書くと、片方だけ直して穴が開く
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null
  const session = await resolveSession(sessionToken)
  if (session !== null && sessionToken !== null) {
    return withRenewedSession(sessionToken, session.expiresAt)
  }

  // 画面の取得は、URL をそのままに案内へ差し替える (redirect ではなく rewrite)。
  // ブラウザのアドレス欄が /item/ABC のまま残るので、ログインすれば
  // 再読み込みだけでその場に戻れる。
  //
  // ここで 401 + WWW-Authenticate を返さないのは意図的。それをやると
  // 「ログインしなくてもヘッダを出す」という今回の目的そのものが壊れ、
  // どのページを開いてもいきなり認証ダイアログが出る昔の挙動に戻る
  if (isPageRequest(request)) {
    const notice = NextResponse.rewrite(new URL(LOGIN_REQUIRED_PATH, request.nextUrl))
    // 根だけは素のまま返す (理由は denyIndexing のコメント)
    return pathname === SITE_ROOT ? notice : denyIndexing(notice)
  }

  // API と書き込み (Server Action の POST を含む) は機械が読む口なので、
  // 案内の HTML を返しても意味がない。素直に断る
  return NextResponse.json(
    { success: false, data: null, error: 'ログインが必要です' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  )
}

// サイトの根。ここだけ noindex を付けない (理由は denyIndexing)
const SITE_ROOT = '/'

// 公開しているが載せる価値のない画面 (docs/90-クローラ対策計画.md §2)。
// どちらも**中身を持たない殻**で、検索結果に出ても空の紙が並ぶだけ:
//
//   /login-required … ログインの案内。rewrite 経由と直接アクセスで扱いを揃える
//   /offline        … オフラインの画面。ノートは 1 件も含まず、中身は端末の
//                     IndexedDB からしか来ない (publicPaths.ts)
//
// 残りの公開パス (使い方の説明・PWA の manifest とアイコン・sw.js) は
// そのまま。説明は読まれて困るものではないし、機械が取りに来るものに
// インデックスの指示は要らない
const NOINDEX_PUBLIC_PATHS = new Set<string>([LOGIN_REQUIRED_PATH, OFFLINE_PATH])

// ログイン案内をインデックスさせない (docs/90-クローラ対策計画.md §2)。
//
// **rewrite だから要る。** redirect と違って応答は「元の URL のまま 200」なので、
// /settings, /trash, /edit/… が中身の同じページとして URL の数だけ並んで見える。
//
// **判定をここに置く理由**は、元のパスが分かるのがこの層だけだから。案内ページ
// (login-required/page.tsx) の metadata に noindex を書くと、rewrite 先が 1 つ
// である以上サイトの根まで巻き込む。そして根は SNS のカード生成クローラーが
// 読む場所で (docs/89-OGP計画.md §6 は `curl -sA Twitterbot https://…/` で
// 確かめている)、noindex を見たクローラーはカードを出さないことがある。
// X は「カードなし」も 1 週間キャッシュするため、壊すと戻すのに時間がかかる。
//
// 根が「ログインが必要です」としてインデックスされるのは害がない。それはサイトの
// 玄関そのもので、中身 (ノート) は 1 件も出ていない。
function denyIndexing(response: NextResponse): NextResponse {
  response.headers.set('X-Robots-Tag', 'noindex')
  return response
}

// セッションの期限を延ばす (docs/29-パスキー計画.md §4)。
//
// **延長をここでしか行わないのは、Cookie を貼り直せる場所がここだけだから**。
// Server Component (session.ts の currentUser) からは Cookie を書けない。
//
// 延ばすのは 1 日に 1 回まで (shouldRenewSession)。毎リクエスト書き換えると、
// ページを開くたびに UPDATE と Set-Cookie が飛ぶ。
//
// 失敗しても素通しする。延長は「90 日が 90 日に戻らなかった」だけの話で、
// そのためにログイン済みの人を締め出す理由はない
async function withRenewedSession(token: string, expiresAt: Date): Promise<NextResponse> {
  const response = NextResponse.next()

  if (!shouldRenewSession(expiresAt, new Date())) {
    return response
  }

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

// 読み取りだけの要求か。isPageRequest と違って /api/ も含む
// (画像配信は読み取りだが API でもあるため)
function isReadRequest(request: NextRequest): boolean {
  return request.method === 'GET' || request.method === 'HEAD'
}

// 人がブラウザで開いている画面かどうか。Server Action は現在のページの URL へ
// POST されるため、メソッドを見ないと「保存」が案内ページに化けて黙って失敗する
function isPageRequest(request: NextRequest): boolean {
  if (!isReadRequest(request)) {
    return false
  }
  return !request.nextUrl.pathname.startsWith('/api/')
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
  //                素通しし、認証は route handler 側の denyUnlessLoggedIn に
  //                任せる — もともとここは楽観的検査で、データに触る入口が正
  //                (冒頭のコメント)。実際に本番で「10MB で切られて ZIP が
  //                壊れて見える」を踏んだ
  //
  // 画面と API はここに残す = 既定で門番を通る。ログイン不要なものは
  // publicPaths.ts に明記する
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/import$).*)'],
}
