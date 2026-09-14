import { generateAuthenticationOptions } from '@simplewebauthn/server'
import type { NextResponse } from 'next/server'
import { apiPasskeyDisabled } from '@/lib/auth/api'
import { denyCrossSite } from '@/lib/route/guard'
import { apiFail, apiOk } from '@/lib/route/respond'
import { listCredentialDescriptors } from '@/lib/auth/passkeys'
import { rememberChallenge } from '@/lib/auth/webauthnChallenge'
import { webauthnConfig } from '@/lib/auth/webauthnConfig'

// ログインの 1 歩目 — チャレンジを配る (docs/29-パスキー計画.md §6)。
//
// **ここはログイン不要**。ログインするための口なので当然だが、その分
// auth/publicPaths.ts の一覧に明記してある (既定は閉じているため、書かないと
// proxy.ts が 401 で止める)。
//
// 未ログインでも叩けるので、返すものは「乱数のチャレンジ」と
// 「登録済み credential ID」だけに留める。ID は認証器を選ぶための値で、
// これだけでは署名を作れない (秘密鍵は端末の中)。
export async function POST(request: Request): Promise<NextResponse> {
  const denied = denyCrossSite(request)
  if (denied) {
    return denied
  }

  const config = webauthnConfig()
  if (config === null) {
    return apiPasskeyDisabled()
  }

  const allowCredentials = await listCredentialDescriptors()
  if (allowCredentials.length === 0) {
    // 何も登録されていないのに認証器のダイアログを出すと、「パスキーが
    // 見つかりません」という素っ気ない失敗になり、次に何をすればよいか
    // 分からない。先に断って、パスワードのほうへ案内する
    return apiFail(
      'パスキーがまだ登録されていません。パスワードでログインしてから登録してください',
      404,
    )
  }

  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    allowCredentials,
    // 端末を持っているだけでは通さない (docs/29 §9)
    userVerification: 'required',
  })

  rememberChallenge(options.challenge)

  return apiOk(options)
}
