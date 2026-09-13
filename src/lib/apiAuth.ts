import type { NextResponse } from 'next/server'
import { isDemoMode } from './appEnv'
import { isCrossSiteRequest } from './crossSite'
import { apiFail } from './route/respond'
import { currentUser } from './session'

// route handler 用の門番 (docs/18-ログイン計画.md)。
// 「ログインしているか」と「自分のページからの呼び出しか」の 2 つを見る。
//
// proxy.ts も /api/* の未ログインを 401 にするが、それは楽観的な検査であって
// 唯一の砦にはしない (Next.js の authentication ガイドが明示している)。
// データに触る手前でもう一度確かめる。
//
// Server Action 側 (actions.ts) は requireUser() で投げてよい。route handler は
// 応答そのものを組み立てる場所なので、投げて 500 にするより 401 を返す。
//
// 使い方:
//   const denied = await denyUnlessLoggedIn()
//   if (denied) return denied
export async function denyUnlessLoggedIn(): Promise<NextResponse | null> {
  if ((await currentUser()) !== null) {
    return null
  }
  return apiFail('ログインが必要です', 401)
}

// 第三者のページから動かされた呼び出しを断る (docs/18-ログイン計画.md §9)。
//
// **ログイン検査だけでは足りない**。Basic 認証は Cookie を使わないので
// SameSite が効かず、ログイン済みのブラウザは第三者のページに置かれた
// <img src="/api/books/…"> にも認証情報を付けてしまう。判定の理由は
// crossSite.ts に書いた。
//
// 使い方 (ログイン検査と並べる。順はログインが先 = uploads.ts と同じ流儀):
//   const denied = (await denyUnlessLoggedIn()) ?? denyCrossSite(request)
//   if (denied) return denied
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
// 使い方 (ログイン検査より前に置く。?? で繋ぐ):
//   const denied = denyIfDemoMode() ?? (await denyUnlessLoggedIn())
//   if (denied) return denied
export function denyIfDemoMode(): NextResponse | null {
  if (!isDemoMode()) {
    return null
  }
  return apiFail('デモモードでは利用できません', 403)
}
