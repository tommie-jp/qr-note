// シークレットの口をブラウザから叩く手順 (docs/51-部分暗号化計画.md §10)。
//
// 断片そのものは application/octet-stream で生のまま運ぶ (base64 は 33% 太る)。
// 鍵まわりだけは数十バイトなので JSON + base64 にする。
//
// **例外の文言はここで日本語にして投げる** (passkeyClient.ts と同じ流儀)。
// 呼ぶ側がそのまま画面に出せるようにするため。

import { base64ToBytes, bytesToBase64 } from './bytesBase64'
import { SECRET_MIME_HEADER } from './secretPayload'
import { secretUrl } from './secrets'

const KEYRING_PATH = '/api/secrets/keyring'

export class SecretApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'SecretApiError'
    this.status = status
  }
}

export interface KeyWrapInfo {
  credentialId: string
  label: string
  // 包んだマスターキー。null = このパスキーではまだ有効にしていない
  wrapped: Uint8Array | null
}

export interface KeyringState {
  initialized: boolean
  verifier: Uint8Array | null
  wraps: KeyWrapInfo[]
}

export async function fetchKeyring(): Promise<KeyringState> {
  const data = (await requestJson(KEYRING_PATH, { method: 'GET' })) as {
    initialized: boolean
    verifier: string | null
    wraps: { credentialId: string; label: string; wrapped: string | null }[]
  }
  return {
    initialized: data.initialized,
    verifier: decodeKey(data.verifier, '検証値'),
    wraps: data.wraps.map((wrap) => ({
      credentialId: wrap.credentialId,
      label: wrap.label,
      wrapped: decodeKey(wrap.wrapped, `包んだ鍵 (${wrap.credentialId})`),
    })),
  }
}

// 鍵材料の base64 を解く。**壊れていたことを黙って「無い」に丸めない** —
// null は「まだ設定していない」という正常な状態を表すので、区別できないまま
// 同じ値にすると、データ破損が「復旧キーが違います」という利用者の操作ミスの
// 顔をして出てくる (何度打ち直しても直らない)。せめて記録は残す。
function decodeKey(value: string | null, what: string): Uint8Array | null {
  if (value === null) {
    return null
  }
  const bytes = base64ToBytes(value)
  if (bytes === null) {
    console.error(`シークレットの${what}が壊れています (base64 として読めない)`)
  }
  return bytes
}

// 初回設定 (検証値 + 最初の包み)。既に設定済みなら 409 で断られる。
export async function initKeyring(
  verifier: Uint8Array,
  credentialId: string,
  wrapped: Uint8Array,
): Promise<void> {
  await requestJson(KEYRING_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      verifier: bytesToBase64(verifier),
      credentialId,
      wrapped: bytesToBase64(wrapped),
    }),
  })
}

// 2 台目以降の包みを足す。
export async function saveKeyWrap(
  credentialId: string,
  wrapped: Uint8Array,
): Promise<void> {
  await requestJson(KEYRING_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credentialId,
      wrapped: bytesToBase64(wrapped),
    }),
  })
}

export interface SecretBlob {
  mime: string
  bytes: Uint8Array
}

// 暗号文をそのまま取る。復号は呼ぶ側 (鍵はサーバに無い)。
export async function fetchSecretBlob(name: string): Promise<SecretBlob> {
  const response = await send(secretUrl(name), { method: 'GET' })
  if (!response.ok) {
    throw new SecretApiError(await failureMessage(response), response.status)
  }
  return {
    mime: response.headers.get('X-Secret-Mime') ?? '',
    bytes: new Uint8Array(await response.arrayBuffer()),
  }
}

// 断片を保存する (新規も編集も同じ口)。名前は呼ぶ側が決める —
// エンベロープの AAD が名前に縛られているため、封をする時点で決まっている
// (secretStore.ts の saveSecret に経緯)。
export async function saveSecret(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<void> {
  await requestJson(secretUrl(name), blobRequest(mime, bytes))
}

function blobRequest(mime: string, bytes: Uint8Array): RequestInit {
  // Uint8Array をそのまま body に渡すと型が噛み合わないため ArrayBuffer 実体を
  // 明示して確保する (secretEnvelope.ts と同じ理由)
  const body = new Uint8Array(bytes.byteLength)
  body.set(bytes)
  return {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      [SECRET_MIME_HEADER]: mime,
    },
    body,
  }
}

// 封筒 ({ success, data, error }) を開けて data だけ返す。
async function requestJson(path: string, init: RequestInit): Promise<unknown> {
  const response = await send(path, init)

  let envelope: { success?: boolean; data?: unknown; error?: string | null }
  try {
    envelope = await response.json()
  } catch {
    throw new SecretApiError(
      `サーバから予期しない応答が返りました (${response.status})`,
      response.status,
    )
  }

  if (!response.ok || envelope.success !== true) {
    throw new SecretApiError(
      envelope.error || `処理に失敗しました (${response.status})`,
      response.status,
    )
  }

  return envelope.data
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { ...init, credentials: 'same-origin' })
  } catch (error) {
    console.error(`${path} への通信に失敗しました`, error)
    throw new SecretApiError('通信に失敗しました。電波の状態を確認してください', 0)
  }
}

// 本文が JSON とは限らない口 (断片の GET) の失敗メッセージ。
async function failureMessage(response: Response): Promise<string> {
  try {
    const envelope = await response.json()
    if (typeof envelope?.error === 'string' && envelope.error !== '') {
      return envelope.error
    }
  } catch {
    // JSON でなければ既定の文言に落とす
  }
  return `シークレットを取得できませんでした (${response.status})`
}
