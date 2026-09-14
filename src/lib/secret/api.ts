// シークレットの口をブラウザから叩く手順 (docs/51-部分暗号化計画.md §10)。
//
// 断片そのものは application/octet-stream で生のまま運ぶ (base64 は 33% 太る)。
// 鍵まわりだけは数十バイトなので JSON + base64 にする。
//
// **例外の文言はここで日本語にして投げる** (auth/passkeyClient.ts と同じ流儀)。
// 呼ぶ側がそのまま画面に出せるようにするため。

import { apiFetch, ApiError, fetchEnvelope } from '../api/envelope'
import { base64ToBytes, bytesToBase64 } from '../bytesBase64'
import { SECRET_MIME_HEADER } from './payload'
import { secretUrl } from './secrets'

const KEYRING_PATH = '/api/secrets/keyring'

// 旧名。封筒の読み手を api/envelope.ts の 1 本にしたので、中身は ApiError そのもの
// (auth/passkeyClient.ts の PasskeyApiError も同じ)
export { ApiError as SecretApiError }

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
  const data = await fetchEnvelope<{
    initialized: boolean
    verifier: string | null
    wraps: { credentialId: string; label: string; wrapped: string | null }[]
  }>(KEYRING_PATH, { method: 'GET' })
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
  await fetchEnvelope(KEYRING_PATH, {
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
  await fetchEnvelope(KEYRING_PATH, {
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
  const response = await apiFetch(secretUrl(name), { method: 'GET' })
  if (!response.ok) {
    throw new ApiError(await failureMessage(response), response.status)
  }
  return {
    mime: response.headers.get('X-Secret-Mime') ?? '',
    bytes: new Uint8Array(await response.arrayBuffer()),
  }
}

// 断片を保存する (新規も編集も同じ口)。名前は呼ぶ側が決める —
// エンベロープの AAD が名前に縛られているため、封をする時点で決まっている
// (secret/store.ts の saveSecret に経緯)。
export async function saveSecret(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<void> {
  await fetchEnvelope(secretUrl(name), blobRequest(mime, bytes))
}

function blobRequest(mime: string, bytes: Uint8Array): RequestInit {
  // Uint8Array をそのまま body に渡すと型が噛み合わないため ArrayBuffer 実体を
  // 明示して確保する (secret/envelope.ts と同じ理由)
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
