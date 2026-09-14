import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { bytesToBase64 } from '../bytesBase64'
import { fetchKeyring, fetchSecretBlob, saveSecret, SecretApiError } from './api'

// シークレットの口をブラウザから叩く手順 (docs/51-部分暗号化計画.md §10)。
// fetch だけを差し替え、画面にそのまま出す例外の文言と status を固定する

const NAME = '0421547b-ee29-4613-a6d4-da0f41f94054'
const fetchMock = vi.fn()

function respond(status: number, body: BodyInit | null, headers: Record<string, string> = {}): void {
  fetchMock.mockResolvedValueOnce(new Response(body, { status, headers }))
}

function envelope(status: number, value: unknown): void {
  respond(status, JSON.stringify(value))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchKeyring', () => {
  test('封筒の data を開けて鍵材料を base64 から戻す', async () => {
    // Arrange
    const key = new Uint8Array([1, 2, 3])
    envelope(200, {
      success: true,
      data: {
        initialized: true,
        verifier: bytesToBase64(key),
        wraps: [{ credentialId: 'cred-1', label: 'iPhone', wrapped: null }],
      },
      error: null,
    })

    // Act
    const keyring = await fetchKeyring()

    // Assert
    expect(keyring).toEqual({
      initialized: true,
      verifier: key,
      wraps: [{ credentialId: 'cred-1', label: 'iPhone', wrapped: null }],
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/secrets/keyring', {
      method: 'GET',
      credentials: 'same-origin',
    })
  })

  test('断られたらサーバの文言と status で投げる', async () => {
    envelope(403, { success: false, data: null, error: 'デモモードでは利用できません' })

    const error = await fetchKeyring().catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(SecretApiError)
    expect(error).toMatchObject({ message: 'デモモードでは利用できません', status: 403 })
  })

  test('JSON でない応答は status 付きの文言で投げる', async () => {
    respond(502, '<html>Bad Gateway</html>')

    await expect(fetchKeyring()).rejects.toMatchObject({
      message: 'サーバから予期しない応答が返りました (502)',
      status: 502,
    })
  })

  test('文言の無い失敗は既定の文言で投げる', async () => {
    envelope(200, { success: false, data: null, error: null })

    await expect(fetchKeyring()).rejects.toMatchObject({
      message: '処理に失敗しました (200)',
      status: 200,
    })
  })

  test('通信が届かなければ status 0 で、原因はログに残す', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = await fetchKeyring().catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(SecretApiError)
    expect(error).toMatchObject({
      message: '通信に失敗しました。電波の状態を確認してください',
      status: 0,
    })
    expect(consoleError).toHaveBeenCalledWith(
      '/api/secrets/keyring への通信に失敗しました',
      expect.any(TypeError),
    )
  })
})

describe('fetchSecretBlob', () => {
  test('暗号文のバイト列と復号後の種別を返す', async () => {
    respond(200, new Uint8Array([9, 8, 7]), { 'X-Secret-Mime': 'image/png' })

    expect(await fetchSecretBlob(NAME)).toEqual({
      mime: 'image/png',
      bytes: new Uint8Array([9, 8, 7]),
    })
  })

  test('断られたらサーバの文言で投げる', async () => {
    envelope(404, { success: false, data: null, error: 'シークレットが見つかりません' })

    await expect(fetchSecretBlob(NAME)).rejects.toMatchObject({
      message: 'シークレットが見つかりません',
      status: 404,
    })
  })

  test('本文が JSON でなければ既定の文言で投げる', async () => {
    respond(500, 'oops')

    await expect(fetchSecretBlob(NAME)).rejects.toMatchObject({
      message: 'シークレットを取得できませんでした (500)',
      status: 500,
    })
  })
})

describe('saveSecret', () => {
  test('生のバイト列を種別ヘッダ付きで PUT し、封筒を確かめる', async () => {
    envelope(200, { success: true, data: { name: NAME }, error: null })

    await saveSecret(NAME, 'text/markdown', new Uint8Array([1, 2]))

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe(`/api/secrets/${NAME}`)
    expect(init).toMatchObject({
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream', 'x-secret-mime': 'text/markdown' },
    })
    expect(init.body).toEqual(new Uint8Array([1, 2]))
  })

  test('保存を断られたら投げる', async () => {
    envelope(413, { success: false, data: null, error: 'ファイルが大きすぎます (最大 10MB)' })

    await expect(saveSecret(NAME, 'image/png', new Uint8Array([1]))).rejects.toMatchObject({
      message: 'ファイルが大きすぎます (最大 10MB)',
      status: 413,
    })
  })
})
