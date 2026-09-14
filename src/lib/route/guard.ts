import type { NextResponse } from 'next/server'
import { isDemoMode } from '@/lib/appEnv'
import { isCrossSiteRequest } from '@/lib/auth/crossSite'
import { currentUser } from '@/lib/auth/session'
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

// 第三者のページから動かされた呼び出しを断る (docs/18-ログイン計画.md §9)。
//
// **ログイン検査だけでは足りない**。Basic 認証は Cookie を使わないので
// SameSite が効かず、ログイン済みのブラウザは第三者のページに置かれた
// <img src="/api/books/…"> にも認証情報を付けてしまう。判定の理由は
// auth/crossSite.ts に書いた。
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
