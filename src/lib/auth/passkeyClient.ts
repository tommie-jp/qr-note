// ブラウザ側からパスキーの口を叩く手順 (docs/29-パスキー計画.md §6)。
//
// 登録もログインも「① チャレンジを貰う → ② 認証器に署名させる →
// ③ 署名を送って検証させる」の 3 歩で、違うのは叩く URL だけ。
// その 3 歩をここに 1 度だけ書き、画面 (ボタン) は結果だけを扱う。
//
// **例外の文言はここで日本語にして投げる**。呼ぶ側がそのまま画面に出せる
// ようにするため。ブラウザや WebAuthn の生のエラー文は英語なうえ、
// 「NotAllowedError」のように理由も分からない。

import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { ApiError, fetchEnvelope } from '../api/envelope'
import {
  PASSKEY_LOGIN_OPTIONS_PATH,
  PASSKEY_LOGIN_VERIFY_PATH,
  PASSKEY_REGISTER_OPTIONS_PATH,
  PASSKEY_REGISTER_VERIFY_PATH,
} from './paths'
import { clearPasskeyHint, markPasskeyUsedHere } from './passkeyHint'

// 利用者が Face ID のダイアログを閉じた・時間切れになった、のいずれか。
// ブラウザはどちらも NotAllowedError にまとめてしまい区別できない。
// **失敗として赤く出さない** — 自分でやめた操作を叱られるのは不快なので、
// 呼ぶ側はこれを見て黙って元に戻す
export class PasskeyCancelledError extends Error {
  constructor() {
    super('パスキーの操作が取り消されました')
    this.name = 'PasskeyCancelledError'
  }
}

export async function loginWithPasskey(): Promise<string> {
  let optionsJSON: unknown
  try {
    optionsJSON = await postForData(PASSKEY_LOGIN_OPTIONS_PATH, {})
  } catch (error) {
    // 404 = サーバに 1 つもパスキーが無い。この端末の実績も無効になったので
    // ヒントを捨てる (残すと毎回空振りの自動発火を試み続ける)。
    // それ以外の失敗 (通信断・503 など) は一時的なものなので実績は残す
    if (error instanceof ApiError && error.status === 404) {
      clearPasskeyHint()
    }
    throw error
  }

  const response = await runAuthenticator(() =>
    startAuthentication({ optionsJSON: optionsJSON as never }),
  )

  const result = (await postForData(PASSKEY_LOGIN_VERIFY_PATH, { response })) as {
    userName: string
  }

  // 「このブラウザでパスキーが使えた」実績。次回から自動ログインを試してよい
  markPasskeyUsedHere()

  return result.userName
}

export async function registerPasskey(label: string): Promise<void> {
  const optionsJSON = await postForData(PASSKEY_REGISTER_OPTIONS_PATH, {})

  const response = await runAuthenticator(() =>
    startRegistration({ optionsJSON: optionsJSON as never }),
  )

  await postForData(PASSKEY_REGISTER_VERIFY_PATH, { response, label })

  // 登録した端末には確実に鍵がある。ログインを待たずに実績として扱ってよい
  markPasskeyUsedHere()
}

// 認証器を動かすところ。取り消しだけを別の例外に翻訳する。
async function runAuthenticator<T>(start: () => Promise<T>): Promise<T> {
  try {
    return await start()
  } catch (error) {
    if (error instanceof Error && error.name === 'NotAllowedError') {
      throw new PasskeyCancelledError()
    }
    if (error instanceof Error && error.name === 'InvalidStateError') {
      // excludeCredentials に当たった = この端末は既に登録済み
      throw new Error('この端末のパスキーは既に登録されています')
    }
    // 残りは環境の問題 (対応していないブラウザなど)。原因を握りつぶさない
    console.error('認証器の呼び出しに失敗しました', error)
    throw new Error('この端末ではパスキーを利用できませんでした')
  }
}

// サーバが断ったときの例外 (旧名)。status を持たせる理由は api/envelope.ts の
// ApiError に書いた — 404 と一時的な失敗を分けるのは上の loginWithPasskey
export { ApiError as PasskeyApiError }

// 封筒 ({ success, data, error }) を開けて data だけ返す (api/envelope.ts)。
// Cookie を送受りする口なので credentials は向こうが same-origin を明示する
function postForData(path: string, body: unknown): Promise<unknown> {
  return fetchEnvelope(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
