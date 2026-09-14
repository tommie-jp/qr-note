import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import type { NextResponse } from 'next/server'
import { apiPasskeyDisabled } from '@/lib/auth/api'
import { findCredential, touchPasskey } from '@/lib/auth/passkeys'
import { denyCrossSite } from '@/lib/route/guard'
import { parseJsonBody } from '@/lib/route/parse'
import { apiFail, apiOk } from '@/lib/route/respond'
import { issueSession } from '@/lib/auth/sessionStore'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth/sessionToken'
import {
  consumeChallenge,
  consumeChallengeFromClientData,
} from '@/lib/auth/webauthnChallenge'
import { webauthnConfig } from '@/lib/auth/webauthnConfig'

// 失敗はどれもこの 1 つの文言で返す (区別しない理由は POST の説明)
const LOGIN_FAILED = 'ログインできませんでした。もう一度お試しください'

// ログインの 2 歩目 — 署名を確かめてセッションを発行する
// (docs/29-パスキー計画.md §4, §6)。
//
// ここが Basic 認証との一番大きな違い。あちらは「ブラウザが毎回ヘッダを
// 送ってくる」ことがセッションの代わりだったが、パスキーの署名はこの 1 回
// きりなので、以後のリクエストを結びつける Cookie をここで発行する。
//
// **失敗の理由は区別せずに返す**。「そのパスキーは知らない」と「署名が
// 違う」を撃ち分けると、どの credential ID が登録済みかを外から数えられる。
export async function POST(request: Request): Promise<NextResponse> {
  const denied = denyCrossSite(request)
  if (denied) {
    return denied
  }

  const config = webauthnConfig()
  if (config === null) {
    return apiPasskeyDisabled()
  }

  const parsed = await parseJsonBody(request, readAuthenticationResponse)
  if (!parsed.ok) {
    return parsed.response
  }
  const response = parsed.value

  const stored = await findCredential(response.id)
  if (stored === null) {
    // 検証まで進まないので expectedChallenge のコールバックが走らない。
    // ここで消しておかないと、知らない credential ID を送りつけるだけで
    // 同じチャレンジを 5 分間何度でも生かしておける
    consumeChallengeFromClientData(response.response?.clientDataJSON)
    return apiFail(LOGIN_FAILED, 401)
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => consumeChallenge(challenge),
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      credential: stored.credential,
      requireUserVerification: true,
    })
  } catch (error) {
    console.error('パスキーのログイン検証に失敗しました', error)
    return apiFail(LOGIN_FAILED, 401)
  }

  if (!verification.verified) {
    return apiFail(LOGIN_FAILED, 401)
  }

  // カウンタを進め、最終使用日時を残す。
  //
  // **巻き戻っていても失効させない** (docs/29 §9)。iCloud キーチェーンで
  // 同期されたパスキーはカウンタが常に 0 のことがあり、硬く倒すと正規の
  // 利用者が締め出される。記録は残すが判断には使わない。
  //
  // 失敗してもログインは通す。カウンタが古いままになるだけで、
  // ここで 500 にすると「署名は正しいのに入れない」になる
  try {
    await touchPasskey(stored.credential.id, verification.authenticationInfo.newCounter)
  } catch (error) {
    console.error('パスキーの使用記録の更新に失敗しました', error)
  }

  const session = await issueSession(stored.userName)

  const result = apiOk({ userName: stored.userName })
  result.cookies.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions())
  return result
}

// 本文の { response } を取り出す。credential ID (response.id) で保存済みの鍵を
// 引くので、それが文字列であるところまで確かめる
function readAuthenticationResponse(
  body: Readonly<Record<string, unknown>>,
): AuthenticationResponseJSON | null {
  if (typeof body.response !== 'object' || body.response === null) {
    return null
  }
  const response = body.response as AuthenticationResponseJSON
  return typeof response.id === 'string' ? response : null
}
