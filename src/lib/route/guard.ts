import type { NextResponse } from 'next/server'
import { isDemoMode } from '@/lib/appEnv'
import { isAdminUser } from '@/lib/auth/admin'
import { isCrossSiteRequest } from '@/lib/auth/crossSite'
import { currentSession, currentUser } from '@/lib/auth/session'
import { isRecentLogin, REAUTH_REQUIRED_MESSAGE } from '@/lib/auth/stepUp'
import { apiFail } from './respond'

// route handler 用の門番 (docs/18-ログイン計画.md)。
// 「デモで閉じる口か」「ログインしているか」「自分のページからの呼び出しか」の
// 3 つを、**いつも同じ順**で見る。順が口ごとに違うと、複数に当たったときに
// どの理由で断るかが口ごとに変わる (route テストがこの順を固定している)。
//
// proxy.ts も /api/* の未ログインを 401 にするが、それは楽観的な検査であって
// 唯一の砦にはしない (Next.js の authentication ガイドが明示している)。
// データに触る手前でもう一度確かめる。
//
// Server Action 側 (app/actions/_guards.ts) は requireUser() で投げてよい。route handler は
// 応答そのものを組み立てる場所なので、投げて 500 にするより 401 を返す。

// 通れば誰か、通らなければそのまま返す応答。
//
// ok: false の response は失敗とは限らない — 検索履歴の口はデモで空のリストを
// 200 で返して打ち切る (search/queryRoute.ts)
export type GuardResult =
  | { readonly ok: true; readonly user: string }
  | { readonly ok: false; readonly response: NextResponse }

export interface GuardOptions {
  // 'deny'  … デモインスタンスでは閉じる口。ログインの有無より前に 403 で断る
  // 'allow' … デモでも開けておく口 (デモでどう振る舞うかは口の側で決める)
  readonly demo: 'deny' | 'allow'
}

// 使い方:
//   const guard = await guardRequest(request, { demo: 'deny' })
//   if (!guard.ok) return guard.response
//   ... guard.user
export async function guardRequest(
  request: Request,
  { demo }: GuardOptions,
): Promise<GuardResult> {
  const demoDenied = demo === 'deny' ? denyIfDemoMode() : null
  if (demoDenied) {
    return { ok: false, response: demoDenied }
  }

  // ログインが先、クロスサイトが後 (uploads/request.ts と同じ流儀)
  const user = await currentUser()
  if (user === null) {
    return { ok: false, response: apiFail('ログインが必要です', 401) }
  }

  const crossSite = denyCrossSite(request)
  if (crossSite) {
    return { ok: false, response: crossSite }
  }

  return { ok: true, user }
}

// 管理者だけの口 (docs/109-サーバー情報計画.md §2。2026-11 の監査 M-5 で共通化)。
// guardRequest の 3 つを通した上で、isAdminUser (env ADMIN_USER との一致) で
// なければ 403。対象は運用系 — ログの消去・計測の切替と取得鍵・履歴の
// バックフィル・ベンチマーク・プロファイル。いまは利用者が 1 名なので実害は
// 無いが、線引きを口ごとに書くと多人数化したときに片方だけ開いたまま残る。
//
// 404 ではなく 403 にするのは API だから (画面は requireAdminPage が 404 に倒す)。
// 導線は管理者にしか出していないので、ここに来るのは URL を知っている人だけ
export async function guardAdminRequest(
  request: Request,
  options: GuardOptions,
): Promise<GuardResult> {
  const guard = await guardRequest(request, options)
  if (!guard.ok) {
    return guard
  }
  if (!isAdminUser(guard.user)) {
    console.warn(`管理者でないユーザーが管理者の口を叩いた (user=${guard.user})`)
    return { ok: false, response: apiFail('管理者だけが使えます', 403) }
  }
  return guard
}

// 「ログインし直したばかり」を要求する口 (auth/stepUp.ts。2026-11 の監査 M-6)。
// パスキーの登録・削除、鍵束の設定、他端末の失効が使う。guardRequest の 3 つを
// 通した上で、セッションの発行時刻が RECENT_LOGIN_MAX_AGE_MS より古ければ 403。
// 文言は画面が「ログインし直す」導線を出す手がかりにする
export async function guardRecentLogin(
  request: Request,
  options: GuardOptions,
): Promise<GuardResult> {
  const guard = await guardRequest(request, options)
  if (!guard.ok) {
    return guard
  }
  const session = await currentSession()
  if (session === null || !isRecentLogin(session.createdAt)) {
    return { ok: false, response: apiFail(REAUTH_REQUIRED_MESSAGE, 403) }
  }
  return guard
}

// 第三者のページから動かされた呼び出しを断る (docs/18-ログイン計画.md §9)。
//
// **ログイン検査だけでは足りない**。セッション Cookie は SameSite=Lax なので
// 第三者のページの <img> や fetch には付かないが、リンクを踏ませる
// トップレベルの遷移 (GET) には付く。判定の理由は auth/crossSite.ts に書いた。
//
// guardRequest の 3 つ目の検査。ログインするための口 (パスキーのログイン・
// ログアウト) はログイン検査を持たないので、これだけを単独で呼ぶ。
export function denyCrossSite(request: Request): NextResponse | null {
  if (!isCrossSiteRequest(request)) {
    return null
  }
  return apiFail('クロスサイトからの呼び出しは許可されていません', 403)
}

// デモインスタンスで閉じる口を断る (docs/38-デモモード計画.md §4)。
// 対象は「共有アカウントのデモでは害しかない」もの — パスキー登録・ENEX
// インポート・ログの閲覧/転送/消去。ログインの有無に依らず塞ぐので、
// ログイン検査より前に置いてよい (デモではログイン済みでも通さない)。
//
// **旗の欠落に頼らない**のが要点。パスキーは WEBAUTHN 未設定でも無効になるが、
// それに寄りかからず明示的に断つ (docs/38 §2 の「欠落は無防備へ倒れる」対策)。
//
// guardRequest の { demo: 'deny' } がこれを最初に呼ぶ。
export function denyIfDemoMode(): NextResponse | null {
  if (!isDemoMode()) {
    return null
  }
  return apiFail('デモモードでは利用できません', 403)
}
