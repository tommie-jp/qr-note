import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// パスキー登録の 2 歩目 (docs/29-パスキー計画.md §6)。
// 署名の検証 (SimpleWebAuthn) と保存 (DB) を差し替え、門番・本文の検算・
// 応答の組み立てを見る
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  verify: vi.fn(),
  savePasskey: vi.fn(),
}))

vi.mock('next/headers', async () => {
  const { SESSION_COOKIE_NAME } = await import('@/lib/auth/sessionToken')
  return {
    headers: async () => new Headers(),
    cookies: async () => ({
      get: (name: string) =>
        name === SESSION_COOKIE_NAME && mocks.sessionToken !== null
          ? { name, value: mocks.sessionToken }
          : undefined,
    }),
  }
})

vi.mock('@/lib/auth/sessionStore', () => ({
  findActiveSession: async (token: string) =>
    token === mocks.validToken
      ? { userName: 'tommie', expiresAt: new Date('2099-01-01T00:00:00.000Z') }
      : null,
}))

vi.mock('@/lib/auth/passkeys', () => ({
  savePasskey: (passkey: unknown) => mocks.savePasskey(passkey),
}))

vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyRegistrationResponse: (options: unknown) => mocks.verify(options),
}))

const { POST } = await import('./route')

const BAD_REQUEST = failEnvelope('リクエストの形式が正しくありません')
const NOT_REGISTERED = failEnvelope('パスキーを登録できませんでした。もう一度お試しください')

function verifyRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/passkey/register-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const VALID_BODY = { response: { id: 'cred-1' }, label: ' iPhone\n15 ' }
const PUBLIC_KEY = new Uint8Array([1, 2, 3])

beforeEach(() => {
  vi.stubEnv('WEBAUTHN_RP_ID', 'localhost')
  vi.stubEnv('WEBAUTHN_ORIGIN', 'http://localhost:3000')
  mocks.sessionToken = mocks.validToken
  mocks.verify.mockReset().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: { id: 'cred-1', publicKey: PUBLIC_KEY, counter: 0, transports: ['internal'] },
    },
  })
  mocks.savePasskey.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('拒否系 (デモ → ログイン → クロスサイト → 設定 → 本文の順)', () => {
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await POST(verifyRequest(VALID_BODY, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  test('未ログインはクロスサイト判定より先に 401', async () => {
    mocks.sessionToken = null

    const res = await POST(verifyRequest(VALID_BODY, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
  })

  test('クロスサイトは 403', async () => {
    const res = await POST(verifyRequest(VALID_BODY, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
  })

  test('WebAuthn の設定が無ければ本文を見る前に 503', async () => {
    vi.stubEnv('WEBAUTHN_RP_ID', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(verifyRequest('{'))

    expect(await responseContract(res)).toEqual(
      jsonContract(503, failEnvelope('この環境ではパスキーを利用できません')),
    )
  })

  test('JSON にならない本文は 400', async () => {
    const res = await POST(verifyRequest('{'))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  test('response が無ければ 400', async () => {
    const res = await POST(verifyRequest({ label: 'iPhone' }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
    expect(mocks.verify).not.toHaveBeenCalled()
  })
})

describe('登録の失敗', () => {
  test('検証が投げたら 400 (理由はログにだけ残す)', async () => {
    mocks.verify.mockRejectedValue(new Error('origin mismatch'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(verifyRequest(VALID_BODY))

    expect(await responseContract(res)).toEqual(jsonContract(400, NOT_REGISTERED))
    expect(consoleError).toHaveBeenCalled()
    expect(mocks.savePasskey).not.toHaveBeenCalled()
  })

  test('検証が通らなければ 400', async () => {
    mocks.verify.mockResolvedValue({ verified: false })

    const res = await POST(verifyRequest(VALID_BODY))

    expect(await responseContract(res)).toEqual(jsonContract(400, NOT_REGISTERED))
  })

  test('保存に失敗したら「もう登録済み」として 409', async () => {
    mocks.savePasskey.mockRejectedValue(new Error('unique violation'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(verifyRequest(VALID_BODY))

    expect(await responseContract(res)).toEqual(
      jsonContract(409, failEnvelope('このパスキーは既に登録されています')),
    )
  })
})

describe('登録の成功', () => {
  test('公開鍵を保存して 201 を返す (名前は正規化して保存する)', async () => {
    const res = await POST(verifyRequest(VALID_BODY, { 'sec-fetch-site': 'same-origin' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(201, okEnvelope({ id: 'cred-1', label: 'iPhone 15' })),
    )
    expect(mocks.savePasskey).toHaveBeenCalledWith({
      id: 'cred-1',
      userName: 'tommie',
      publicKey: PUBLIC_KEY,
      counter: 0,
      transports: ['internal'],
      label: 'iPhone 15',
    })
  })
})
