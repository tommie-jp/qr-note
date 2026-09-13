import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  __resetChallengesForTest,
  consumeChallenge,
} from '@/lib/webauthnChallenge'
import { failEnvelope, jsonContract, responseContract } from '@/test/routeResponse'

// パスキー登録の 1 歩目 (docs/29-パスキー計画.md §6)。
// 他の route テストと同じ流儀: next/headers とセッションの DB だけを差し替え、
// 門番 (デモ → ログイン → クロスサイト) の判定そのものは本物を通す
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  descriptors: [] as Array<{ id: string; transports?: string[] }>,
}))

vi.mock('next/headers', async () => {
  const { SESSION_COOKIE_NAME } = await import('@/lib/sessionToken')
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

vi.mock('@/lib/sessionStore', () => ({
  findActiveSession: async (token: string) =>
    token === mocks.validToken
      ? { userName: 'tommie', expiresAt: new Date('2099-01-01T00:00:00.000Z') }
      : null,
}))

vi.mock('@/lib/passkeys', () => ({
  listCredentialDescriptors: async () => mocks.descriptors,
}))

const { POST } = await import('./route')

function optionsRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/passkey/register-options', {
    method: 'POST',
    headers,
  })
}

beforeEach(() => {
  vi.stubEnv('WEBAUTHN_RP_ID', 'localhost')
  vi.stubEnv('WEBAUTHN_ORIGIN', 'http://localhost:3000')
  mocks.sessionToken = mocks.validToken
  mocks.descriptors = [{ id: 'cred-1', transports: ['internal'] }]
  __resetChallengesForTest()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('拒否系 (デモ → ログイン → クロスサイトの順)', () => {
  test('デモは未ログインでもクロスサイトでも 403 (最初に断る)', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await POST(optionsRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
  })

  test('未ログインはクロスサイト判定より先に 401', async () => {
    mocks.sessionToken = null

    const res = await POST(optionsRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
  })

  test('クロスサイトは 403', async () => {
    const res = await POST(optionsRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
  })

  test('WebAuthn の設定が無ければ 503', async () => {
    vi.stubEnv('WEBAUTHN_RP_ID', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(optionsRequest())

    expect(await responseContract(res)).toEqual(
      jsonContract(503, failEnvelope('この環境ではパスキーを利用できません')),
    )
  })
})

describe('チャレンジを配る', () => {
  test('ログイン中の利用者名で登録オプションを返し、チャレンジを控える', async () => {
    const res = await POST(optionsRequest({ 'sec-fetch-site': 'same-origin' }))

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['success', 'data', 'error'])
    expect(body).toMatchObject({
      success: true,
      error: null,
      data: {
        rp: { id: 'localhost' },
        user: { name: 'tommie' },
        attestation: 'none',
        excludeCredentials: [{ id: 'cred-1', type: 'public-key', transports: ['internal'] }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      },
    })
    expect(consumeChallenge(body.data.challenge)).toBe(true)
  })
})
