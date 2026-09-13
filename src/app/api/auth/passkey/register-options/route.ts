import { generateRegistrationOptions } from '@simplewebauthn/server'
import type { NextResponse } from 'next/server'
import { apiPasskeyDisabled } from '@/lib/authApi'
import { denyCrossSite, denyIfDemoMode, denyUnlessLoggedIn } from '@/lib/apiAuth'
import { apiFail, apiOk } from '@/lib/route/respond'
import { listCredentialDescriptors } from '@/lib/passkeys'
import { currentUser } from '@/lib/session'
import { rememberChallenge } from '@/lib/webauthnChallenge'
import { stableUserHandle, webauthnConfig } from '@/lib/webauthnConfig'

// パスキー登録の 1 歩目 — チャレンジを配る (docs/29-パスキー計画.md §6)。
//
// **門番は既存の requireUser 系そのまま**。ここが「登録には既にログインして
// いることが要る」を担保する唯一の場所で、それが Basic 認証を残した理由の
// 半分でもある (docs/29 §2)。初回はパスワードで入って登録し、2 台目からは
// パスキーで入ったまま同じ口で追加登録できる。
export async function POST(request: Request): Promise<NextResponse> {
  // デモでは登録を閉じる (docs/38 §4)。共有アカウントに他人がパスキーを
  // 足せてしまうため。ログインの有無より前に断つ
  const denied =
    denyIfDemoMode() ?? (await denyUnlessLoggedIn()) ?? denyCrossSite(request)
  if (denied) {
    return denied
  }

  const config = webauthnConfig()
  if (config === null) {
    return apiPasskeyDisabled()
  }

  // denyUnlessLoggedIn を通っている以上 null にはならないが、型のために見る
  const userName = await currentUser()
  if (userName === null) {
    return apiFail('ログインが必要です', 401)
  }

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName,
    // 利用者名から決まる固定値にする。登録のたびに乱数だと、認証器から見て
    // 「別々のアカウント」になり、iCloud キーチェーンに同じ名前の項目が
    // いくつも並ぶ (docs/29 §11 のとおり利用者は 1 名なので、1 つに見せる)
    userID: stableUserHandle(userName),
    // 認証器の真正性までは要求しない。使うのは自分だけ (docs/29 §9)
    attestationType: 'none',
    // 既に登録済みの端末で二重登録しようとしたとき、認証器の側で
    // 「もう登録済み」と教えてもらう
    excludeCredentials: await listCredentialDescriptors(),
    authenticatorSelection: {
      // 端末そのものに鍵を残す (パスキー)。ユーザ名を打たずにログインできる
      residentKey: 'preferred',
      // 端末を持っているだけでは通さない。Face ID / PIN を必ず要求する
      userVerification: 'required',
    },
  })

  // 出したチャレンジを覚える。検証はこの控えと突き合わせる (5 分・使い捨て)
  rememberChallenge(options.challenge)

  return apiOk(options)
}
