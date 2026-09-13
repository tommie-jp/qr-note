// セッショントークンの作り方と寿命 (docs/29-パスキー計画.md §4)。
//
// パスキーは「ログインの瞬間に 1 回署名する」だけの仕組みで、Basic 認証の
// ように毎リクエスト資格情報が飛んでくるわけではない。その後のリクエストを
// 誰と結びつけるかを自前で持つ必要があり、それがこのトークン。
//
// この階層は DB にも next/headers にも触らない (純粋な計算だけ)。
// 行の読み書きは sessionStore.ts、リクエストとの結びつけは requestAuth.ts。

import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

// `__Host-` 接頭辞を付ける。ブラウザはこの名前の Cookie を
//
//   * Secure であること
//   * Path=/ であること
//   * **Domain 属性が無いこと** (= そのホスト専用)
//
// が揃わない限り受け取らない。効くのは 3 つ目で、隣のサブドメイン
// (例: 同じ tommie.jp 配下の別アプリ) が乗っ取られても
// `Domain=.tommie.jp` で qr.tommie.jp にセッション Cookie を差し込めなくなる
// (cookie tossing → セッション固定攻撃)。接頭辞が無いと、この差し込みを
// ブラウザ側で拒めない。
//
// 名前を変えると既存の Cookie は無効になるが、ログインし直せば済む
export const SESSION_COOKIE_NAME = '__Host-qr_session'

// 90 日のスライディング。使うたびに 90 日先へ延びる。
// 短くしても Face ID の回数が増えるだけで、守りの本体は端末のロックのほう
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

// 延長は 1 日に 1 回まで。毎リクエスト expiresAt を書き換えると、ページを
// 開くたびに UPDATE が飛ぶ (proxy.ts は全リクエストを通る)
export const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000

// 32 バイト = 256bit。総当たりで当てられる長さにしない。
// base64url にするのは Cookie の値に入れるため — 生の base64 は '+' '/' '='
// を含み、Cookie の値としては引用符が要る文字が混じる
export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// DB に置くのはこのハッシュだけ。生のトークンはブラウザの Cookie にしか
// 存在しない (pg_dump が漏れてもセッションを乗っ取れないようにするため)。
//
// bcrypt ではなく sha256 でよい。ハッシュを遅くするのは「短くて推測できる
// 秘密」を総当たりから守るためで、こちらは 256bit の乱数なので推測の余地がない。
// むしろ毎リクエスト照合する場所なので速いほうがよい
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

// 新しい Date を返す (引数は書き換えない)
export function sessionExpiresAt(now: Date): Date {
  return new Date(now.getTime() + SESSION_TTL_MS)
}

// 期限を延ばし直す頃合いか。「発行 (or 前回の延長) から
// SESSION_RENEW_AFTER_MS 以上経ったか」を残り時間から逆算して見る
export function shouldRenewSession(expiresAt: Date, now: Date): boolean {
  const remaining = expiresAt.getTime() - now.getTime()
  return remaining < SESSION_TTL_MS - SESSION_RENEW_AFTER_MS
}

// Cookie に付ける属性。
//
// secure は常に付ける。http://localhost は現代のブラウザでは「安全な文脈」
// として扱われ Secure 属性の Cookie を受け取れるうえ、そもそも WebAuthn が
// 動くブラウザはすべてその扱いをする。環境で分岐させると、分岐を間違えた
// 本番が平文で Cookie を配る側に倒れうるので、分岐そのものを持たない。
//
// **ここの 3 つ (secure / path / Domain 無し) は `__Host-` 接頭辞の条件でもある**。
// 崩すと Cookie が黙って捨てられ、「ログインしても入れない」になる。
//
// SameSite=Lax … Cookie 認証になったことで初めて効くようになった守り
// (Basic 認証には無かった。docs/18 §9 / docs/29 §9)
export interface SessionCookieOptions {
  httpOnly: true
  secure: true
  sameSite: 'lax'
  path: '/'
  maxAge: number
}

export function sessionCookieOptions(): SessionCookieOptions {
  return {
    // JS から読めないようにする。読めると XSS がそのままセッション奪取になる
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    // 秒で指定する (ミリ秒ではない)
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}
