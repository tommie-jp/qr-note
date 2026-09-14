// ログインの門番 (proxy.ts) の判定 (docs/18-ログイン計画.md)。
//
// proxy.ts はリクエストから下の入力を集め、ここの判定を NextResponse に写すだけ。
// 判定は Request も NextResponse も知らない純関数にして、分岐を表で確かめられる
// ようにする (docs/93-リファクタリング計画.md §4-9)。
//
// セッションの照合 (DB) は**要るときにだけ引く**。公開パスや自前で判定する口の
// 読み取りまで引くと、DB が落ちたときに使い方のページまで巻き添えになる。
// そのため判定を 2 段に分ける:
//
//   decideWithoutSession … セッションを見ずに決まる分岐。決まらなければ null
//   decideWithSession    … 照合した結果で決める残りの分岐

import { LOGIN_REQUIRED_PATH } from './loginRedirect'
import { loopbackRedirectUrl } from './loopbackRedirect'
import { OFFLINE_PATH } from '../offline/params'
import { isPublicPath, isSelfGuardedPath } from './publicPaths'
import { isPageRequest, isReadRequest } from './requestKind'
import { shouldRenewSession } from './sessionToken'

export interface ProxyRequest {
  // 判定は Host ヘッダで行う。request.nextUrl のホストは Next.js が
  // localhost に正規化してしまい、127.0.0.1 で開いても見分けられない
  readonly host: string | null
  readonly url: URL
  readonly method: string
  readonly isProduction: boolean
}

// 照合できたセッション。Cookie の値と期限 (延長の判断に要る)
export interface ProxySession {
  readonly token: string
  readonly expiresAt: Date
}

export type ProxyDecision =
  // ループバック IP から localhost へ送り直す
  | { readonly kind: 'loopback-redirect'; readonly location: string }
  | { readonly kind: 'pass' }
  // 通すが検索エンジンに載せない
  | { readonly kind: 'pass-noindex' }
  // 通したうえで、セッションの期限を延ばして Cookie を貼り直す
  | { readonly kind: 'pass-with-renewal'; readonly token: string }
  // URL をそのままにログインの案内へ差し替える
  | { readonly kind: 'rewrite-login-required'; readonly noindex: boolean }
  // 401 の JSON で断る
  | { readonly kind: 'unauthorized' }

// サイトの根。ここだけ noindex を付けない (理由は decideWithSession の案内)
const SITE_ROOT = '/'

// 公開しているが載せる価値のない画面 (docs/90-クローラ対策計画.md §2)。
// どちらも**中身を持たない殻**で、検索結果に出ても空の紙が並ぶだけ:
//
//   /login-required … ログインの案内。rewrite 経由と直接アクセスで扱いを揃える
//   /offline        … オフラインの画面。ノートは 1 件も含まず、中身は端末の
//                     IndexedDB からしか来ない (auth/publicPaths.ts)
//
// 残りの公開パス (使い方の説明・PWA の manifest とアイコン・sw.js) は
// そのまま。説明は読まれて困るものではないし、機械が取りに来るものに
// インデックスの指示は要らない
const NOINDEX_PUBLIC_PATHS = new Set<string>([LOGIN_REQUIRED_PATH, OFFLINE_PATH])

export function decideWithoutSession(request: ProxyRequest): ProxyDecision | null {
  const { pathname } = request.url

  // ループバック IP で開かれたら localhost へ送り直す (非本番だけ)。
  // パスキーは rpID にドメイン名を要求し 127.0.0.1 では使えないのに、
  // VS Code の「Open in Browser」は必ず 127.0.0.1 を開くため
  // (理由と出典は auth/loopbackRedirect.ts)。
  //
  // ログイン検査より前に置く。未ログインの案内を 127.0.0.1 で見せてから
  // 送り直しても、そこで押したログインが結局使えない
  const loopbackTarget = loopbackRedirectUrl(request.host, request.url, request.isProduction)
  if (loopbackTarget !== null) {
    return { kind: 'loopback-redirect', location: loopbackTarget }
  }

  if (isPublicPath(pathname)) {
    return NOINDEX_PUBLIC_PATHS.has(pathname) ? { kind: 'pass-noindex' } : { kind: 'pass' }
  }

  // 公開かどうかがデータで決まる口 (docs/22-ノート公開計画.md §1)。
  // 公開ノートは未ログインでも読めるが、それを判断できるのは行を見た後なので、
  // ここでは決められない。**読み取りだけ**通し、判定はページ / route handler の
  // isPublicItem() に委ねる。委ね先は auth/publicPaths.ts の一覧に明記されているので、
  // 「新しいページを足したら黙って公開されていた」は起きない。
  //
  // 書き込み (Server Action の POST) をここで通さないのが要点。通すと
  // requireUser() だけが防波堤になり、公開ノートが誰でも書ける口に一歩近づく。
  // 公開は読み取り専用と決めた以上、門番の側でも閉じておく
  if (isSelfGuardedPath(pathname) && isReadRequest(request.method)) {
    return { kind: 'pass' }
  }

  return null
}

// session は照合の結果 (無効・期限切れ・Cookie 無しは null)。
// 照合そのもの (セッション Cookie だけを見る) は auth/requestAuth.ts が持つ。
// ここと session.ts の二か所に書くと、片方だけ直して穴が開く
export function decideWithSession(
  request: ProxyRequest,
  session: ProxySession | null,
  now: Date,
): ProxyDecision {
  if (session !== null) {
    // 延ばすのは 1 日に 1 回まで (shouldRenewSession)。毎リクエスト書き換えると、
    // ページを開くたびに UPDATE と Set-Cookie が飛ぶ (docs/29-パスキー計画.md §4)
    return shouldRenewSession(session.expiresAt, now)
      ? { kind: 'pass-with-renewal', token: session.token }
      : { kind: 'pass' }
  }

  const { pathname } = request.url

  // 画面の取得は、URL をそのままに案内へ差し替える (redirect ではなく rewrite)。
  // ブラウザのアドレス欄が /item/ABC のまま残るので、ログインすれば
  // 再読み込みだけでその場に戻れる。
  //
  // ここで 401 + WWW-Authenticate を返さないのは意図的。それをやると
  // 「ログインしなくてもヘッダを出す」という今回の目的そのものが壊れ、
  // どのページを開いてもいきなり認証ダイアログが出る昔の挙動に戻る。
  //
  // 案内はインデックスさせない (docs/90-クローラ対策計画.md §2)。
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
  if (isPageRequest(request.method, pathname)) {
    return { kind: 'rewrite-login-required', noindex: pathname !== SITE_ROOT }
  }

  // API と書き込み (Server Action の POST を含む) は機械が読む口なので、
  // 案内の HTML を返しても意味がない。素直に断る
  return { kind: 'unauthorized' }
}
