// 認証器から PRF 出力を貰う (docs/51-部分暗号化計画.md §6)。ブラウザ専用。
//
// **SimpleWebAuthn を通さず navigator.credentials.get() を直に呼ぶ**。理由は 2 つ:
//
// 1. PRF の salt も出力も ArrayBuffer で、JSON を介す SimpleWebAuthn の口では
//    素通しできない (出力が {} に化ける)。
// 2. **この署名はサーバへ送らない**。ログインの署名と違い、サーバ側で何かを
//    判断するためのものではないため。鍵の正体は PRF 出力そのもので、それを
//    出せるのは本物の認証器だけ。チャレンジもクライアントで作ってよい
//    (誰かに検証させるための値ではない)。
//
// 出力は**クレデンシャルごと**に決まる (端末ごとではない)。iCloud キーチェーンで
// 同期されたパスキーは iPhone / iPad / Mac で同じ値を返す。

import { base64UrlToBytes } from './bytesBase64'
import { PRF_SALT } from './secretKeyring'

// DOM の型定義にはまだ PRF 拡張が無いため、必要な形だけをここで名乗る。
interface PrfExtensionInput {
  prf: { eval: { first: BufferSource } }
}

interface PrfExtensionOutput {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
}

export interface PrfAssertion {
  // 応えたパスキーの credential ID (base64url)。webauthn_credentials.id と同じ形
  credentialId: string
  // 32 バイトの PRF 出力。**これが鍵の素**なので、決してサーバへ送らない
  prfOutput: Uint8Array
}

// 利用者が Face ID を閉じた・時間切れ (passkeyClient.ts と同じ扱い方)。
// **失敗として赤く出さない** — 自分でやめた操作を叱られるのは不快なため。
export class SecretCancelledError extends Error {
  constructor() {
    super('パスキーの操作が取り消されました')
    this.name = 'SecretCancelledError'
  }
}

// 認証器が PRF に応えられなかった。**環境の問題であって利用者の失敗ではない**
// ので、呼ぶ側は復旧キーへ案内する。
export class PrfUnsupportedError extends Error {
  constructor(
    message = 'この環境ではパスキーから鍵を取り出せません (PRF 非対応)。復旧キーをお使いください',
  ) {
    super(message)
    this.name = 'PrfUnsupportedError'
  }
}

export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined'
  )
}

// 認証器に PRF 出力を出させる。
//
// allowCredentialIds を渡すと、その中から選ばせる (登録済みのパスキーだけを
// 対象にする)。空で呼ぶと、この端末が持つこのサイトのパスキーから選ばれる。
export async function requestPrf(
  allowCredentialIds: readonly string[] = [],
): Promise<PrfAssertion> {
  if (!isWebAuthnAvailable()) {
    throw new PrfUnsupportedError('この環境ではパスキーを利用できません')
  }

  const decoded = allowCredentialIds.map((id) => ({ id, bytes: base64UrlToBytes(id) }))

  // 読めない ID を**黙って落とさない**。起こらないはずだが、起きると
  // 「登録したはずのパスキーが選択肢に出てこない」という原因の掴めない
  // 不具合になる。落とす事実だけは残す
  for (const { id, bytes } of decoded) {
    if (bytes === null) {
      console.error(`credential ID を base64url として読めません: ${id}`)
    }
  }

  const allowCredentials = decoded
    .filter(
      (entry): entry is { id: string; bytes: Uint8Array<ArrayBuffer> } =>
        entry.bytes !== null,
    )
    .map((entry) => ({ type: 'public-key' as const, id: entry.bytes }))

  let credential: Credential | null
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        // サーバへ送らないので、ここで作ってよい (冒頭の理由 2)
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials,
        // 端末を持っているだけでは鍵を出させない (docs/29 §9 と同じ厳しさ)
        userVerification: 'required',
        extensions: {
          prf: { eval: { first: PRF_SALT } },
        } as AuthenticationExtensionsClientInputs & PrfExtensionInput,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'NotAllowedError') {
      throw new SecretCancelledError()
    }
    console.error('認証器の呼び出しに失敗しました', error)
    throw new PrfUnsupportedError()
  }

  if (credential === null || !('getClientExtensionResults' in credential)) {
    throw new PrfUnsupportedError()
  }

  const assertion = credential as PublicKeyCredential
  const results = assertion.getClientExtensionResults() as PrfExtensionOutput
  const first = results.prf?.results?.first

  // PRF に対応していない認証器・ブラウザはここで空になる。**黙って別の鍵を
  // でっち上げない** — 弱い鍵で暗号化してしまうより、断って復旧キーへ導く
  if (!first || first.byteLength === 0) {
    // QR (hybrid) で別の端末に委譲した場合、**認証は通るのに PRF の出力だけが
    // 返ってこない** (iPad → iPhone の実機で確認。docs/51 §6)。ただの
    // 「非対応」と出すと、この端末のパスキーなら開けることが伝わらないので、
    // 経路を見て文言を分ける。authenticatorAttachment は QR・セキュリティ
    // キー経由だと 'cross-platform' になる
    if (assertion.authenticatorAttachment === 'cross-platform') {
      throw new PrfUnsupportedError(
        'QR で別の端末に委譲したパスキーからは鍵を取り出せません。この端末に保存されたパスキーを選ぶか、復旧キーをお使いください',
      )
    }
    throw new PrfUnsupportedError()
  }

  return { credentialId: assertion.id, prfOutput: new Uint8Array(first) }
}
