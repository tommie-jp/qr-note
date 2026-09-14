import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  __resetChallengesForTest,
  consumeChallenge,
} from '@/lib/auth/webauthnChallenge'
import { failEnvelope, jsonContract, responseContract } from '@/test/routeResponse'

// ログインの 1 歩目 (docs/29-パスキー計画.md §6)。
// 登録済みパスキーの一覧 (DB) だけを差し替え、設定・チャレンジの控え・
// SimpleWebAuthn のオプション生成は本物を通す
const mocks = vi.hoisted(() => ({
  descriptors: [] as Array<{ id: string; transports?: string[] }>,
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}))

vi.mock('@/lib/auth/sessionStore', () => ({
  findActiveSession: async () => null,
}))

vi.mock('@/lib/auth/passkeys', () => ({
  listCredentialDescriptors: async () => mocks.descriptors,
}))

const { POST } = await import('./route')

function optionsRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/passkey/login-options', {
    method: 'POST',
    headers,
  })
}

beforeEach(() => {
  vi.stubEnv('WEBAUTHN_RP_ID', 'localhost')
  vi.stubEnv('WEBAUTHN_ORIGIN', 'http://localhost:3000')
  mocks.descriptors = [{ id: 'cred-1', transports: ['internal'] }]
  __resetChallengesForTest()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('拒否系', () => {
  test('クロスサイトは設定の有無より先に 403', async () => {
    vi.stubEnv('WEBAUTHN_RP_ID', '')

    const res = await POST(optionsRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
  })

  test('WebAuthn の設定が無ければ 503', async () => {
    vi.stubEnv('WEBAUTHN_RP_ID', '')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(optionsRequest())

    expect(await responseContract(res)).toEqual(
      jsonContract(503, failEnvelope('この環境ではパスキーを利用できません')),
    )
    expect(consoleError).toHaveBeenCalled()
  })

  test('パスキーが 1 つも無ければ 404 (パスワードへ案内する)', async () => {
    mocks.descriptors = []

    const res = await POST(optionsRequest())

    expect(await responseContract(res)).toEqual(
      jsonContract(
        404,
        failEnvelope(
          'パスキーがまだ登録されていません。パスワードでログインしてから登録してください',
        ),
      ),
    )
  })
})

describe('チャレンジを配る', () => {
  // ログインするための口なので、未ログインでも通る (Cookie なし)
  test('未ログインでもオプションを返し、チャレンジを控える', async () => {
    const res = await POST(optionsRequest({ 'sec-fetch-site': 'same-origin' }))

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({
      success: true,
      error: null,
      data: {
        rpId: 'localhost',
        allowCredentials: [{ id: 'cred-1', type: 'public-key', transports: ['internal'] }],
        userVerification: 'required',
      },
    })
    expect(Object.keys(body)).toEqual(['success', 'data', 'error'])
    // 検証は控えと突き合わせる。配ったチャレンジが控えにあること
    expect(consumeChallenge(body.data.challenge)).toBe(true)
  })
})
