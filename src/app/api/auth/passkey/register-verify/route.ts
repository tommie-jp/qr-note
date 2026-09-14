import { verifyRegistrationResponse } from '@simplewebauthn/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import type { NextResponse } from 'next/server'
import { apiPasskeyDisabled } from '@/lib/auth/api'
import { normalizePasskeyLabel } from '@/lib/auth/passkeyLabel'
import { savePasskey } from '@/lib/auth/passkeys'
import { guardRequest } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiFail, apiOk } from '@/lib/route/respond'
import { consumeChallenge } from '@/lib/auth/webauthnChallenge'
import { webauthnConfig } from '@/lib/auth/webauthnConfig'

// パスキー登録の 2 歩目 — 認証器が作った公開鍵を確かめて保存する
// (docs/29-パスキー計画.md §6)。
export async function POST(request: Request): Promise<NextResponse> {
  // デモでは登録を閉じる (docs/38 §4。register-options と対で塞ぐ)
  const guard = await guardRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }

  const config = webauthnConfig()
  if (config === null) {
    return apiPasskeyDisabled()
  }

  const body = await parseJsonBody(request, (fields) =>
    typeof fields.response === 'object' && fields.response !== null
      ? { response: fields.response as RegistrationResponseJSON, label: fields.label }
      : null,
  )
  if (!body.ok) {
    return body.response
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.value.response,
      // 控えにあって、まだ使われていないチャレンジだけを通す。
      // この関数は成否によらず消費する (リプレイを断つ)
      expectedChallenge: (challenge) => consumeChallenge(challenge),
      // 設定から取る。リクエストからは組み立てない (docs/29 §7)
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      // Face ID / PIN を経ていない登録は受け取らない
      requireUserVerification: true,
    })
  } catch (error) {
    // 壊れた応答・期限切れのチャレンジ・origin 違いはすべてここへ来る。
    // 中身は素性の知れない入力なので画面には返さず、ログにだけ残す
    console.error('パスキーの登録検証に失敗しました', error)
    return apiFail('パスキーを登録できませんでした。もう一度お試しください', 400)
  }

  if (!verification.verified) {
    return apiFail('パスキーを登録できませんでした。もう一度お試しください', 400)
  }

  const { credential } = verification.registrationInfo
  const label = normalizePasskeyLabel(body.value.label)

  try {
    await savePasskey({
      id: credential.id,
      userName: guard.user,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports ?? [],
      label,
    })
  } catch (error) {
    // 同じ鍵をもう一度登録した (excludeCredentials をすり抜けた) 場合。
    // 主キーの衝突なので、失敗ではなく「もう登録済み」として伝える
    console.error('パスキーの保存に失敗しました', error)
    return apiFail('このパスキーは既に登録されています', 409)
  }

  return apiOk({ id: credential.id, label }, 201)
}
