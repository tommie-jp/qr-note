import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { loginWithPasskey, PasskeyApiError, registerPasskey } from './passkeyClient'
import { hasPasskeyHint, markPasskeyUsedHere } from './passkeyHint'

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}))

const startAuthenticationMock = vi.mocked(startAuthentication)
const startRegistrationMock = vi.mocked(startRegistration)

function createStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

// 封筒 ({ success, data, error }) を返す fetch を組み立てる
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function ok(data: unknown): Response {
  return jsonResponse(200, { success: true, data, error: null })
}

function fail(status: number, error: string): Response {
  return jsonResponse(status, { success: false, data: null, error })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  const storage = createStorage()
  vi.stubGlobal('window', { localStorage: storage, sessionStorage: createStorage() })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  startAuthenticationMock.mockResolvedValue({ id: 'cred-1' } as never)
  startRegistrationMock.mockResolvedValue({ id: 'cred-1' } as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('loginWithPasskey', () => {
  test('returns the user name the server verified', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ challenge: 'abc' }))
      .mockResolvedValueOnce(ok({ userName: 'tommie' }))

    expect(await loginWithPasskey()).toBe('tommie')
  })

  test('remembers that a passkey worked on this browser', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ challenge: 'abc' }))
      .mockResolvedValueOnce(ok({ userName: 'tommie' }))

    await loginWithPasskey()

    // 次回このブラウザでは自動ログインを試してよい
    expect(hasPasskeyHint()).toBe(true)
  })

  test('does not leave a hint when the login failed', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ challenge: 'abc' }))
      .mockResolvedValueOnce(fail(401, 'ログインできませんでした'))

    await expect(loginWithPasskey()).rejects.toThrow()
    expect(hasPasskeyHint()).toBe(false)
  })

  test('forgets the hint when the server has no passkeys left (404)', async () => {
    markPasskeyUsedHere()
    fetchMock.mockResolvedValueOnce(fail(404, 'パスキーがまだ登録されていません'))

    await expect(loginWithPasskey()).rejects.toThrow()

    // 鍵が消えているのに毎回自動発火を試み続けないようにする
    expect(hasPasskeyHint()).toBe(false)
  })

  test('keeps the hint for failures that are not "no passkeys" (e.g. offline)', async () => {
    markPasskeyUsedHere()
    fetchMock.mockResolvedValueOnce(fail(503, 'この環境ではパスキーを利用できません'))

    await expect(loginWithPasskey()).rejects.toThrow()

    // 一時的な失敗で実績まで捨てない
    expect(hasPasskeyHint()).toBe(true)
  })
})

describe('registerPasskey', () => {
  test('remembers that a passkey exists on this browser', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ challenge: 'abc' }))
      .mockResolvedValueOnce(ok({ id: 'cred-1', label: 'iPhone' }))

    await registerPasskey('iPhone')

    // 登録した端末は次回から自動ログインの対象になる
    expect(hasPasskeyHint()).toBe(true)
  })

  test('does not leave a hint when the registration failed', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ challenge: 'abc' }))
      .mockResolvedValueOnce(fail(409, 'このパスキーは既に登録されています'))

    await expect(registerPasskey('iPhone')).rejects.toThrow()
    expect(hasPasskeyHint()).toBe(false)
  })
})

describe('PasskeyApiError', () => {
  test('carries the HTTP status so callers can tell 404 from the rest', async () => {
    fetchMock.mockResolvedValueOnce(fail(404, 'パスキーがまだ登録されていません'))

    const error = await loginWithPasskey().catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(PasskeyApiError)
    expect((error as PasskeyApiError).status).toBe(404)
  })

  test('keeps the server message so the screen can show it as-is', async () => {
    fetchMock.mockResolvedValueOnce(fail(503, 'この環境ではパスキーを利用できません'))

    const error = await loginWithPasskey().catch((cause: unknown) => cause)

    expect((error as Error).message).toBe('この環境ではパスキーを利用できません')
  })
})
