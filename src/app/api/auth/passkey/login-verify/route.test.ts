import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// ログインの 2 歩目 (docs/29-パスキー計画.md §4, §6)。
// 署名の検証 (SimpleWebAuthn) と DB (パスキー・セッション) を差し替え、
// 門番と応答の組み立てを見る
const mocks = vi.hoisted(() => ({
  stored: null as null | { userName: string; credential: { id: string; counter: number } },
  verify: vi.fn(),
  touchPasskey: vi.fn(),
  issueSession: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}))

vi.mock('@/lib/auth/sessionStore', () => ({
  findActiveSession: async () => null,
  issueSession: (userName: string) => mocks.issueSession(userName),
}))

vi.mock('@/lib/auth/passkeys', () => ({
  findCredential: async () => mocks.stored,
  touchPasskey: (id: string, counter: number) => mocks.touchPasskey(id, counter),
}))

vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyAuthenticationResponse: (options: unknown) => mocks.verify(options),
}))

const { POST } = await import('./route')

const LOGIN_FAILED = failEnvelope('ログインできませんでした。もう一度お試しください')
const BAD_REQUEST = failEnvelope('リクエストの形式が正しくありません')

function verifyRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/auth/passkey/login-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const VALID_BODY = { response: { id: 'cred-1', response: { clientDataJSON: '' } } }

beforeEach(() => {
  vi.stubEnv('WEBAUTHN_RP_ID', 'localhost')
  vi.stubEnv('WEBAUTHN_ORIGIN', 'http://localhost:3000')
  mocks.stored = { userName: 'tommie', credential: { id: 'cred-1', counter: 3 } }
  mocks.verify.mockReset().mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 4 },
  })
  mocks.touchPasskey.mockReset().mockResolvedValue(undefined)
  mocks.issueSession.mockReset().mockResolvedValue({
    token: 'issued-token',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('拒否系', () => {
  test('クロスサイトは 403', async () => {
    const res = await POST(verifyRequest(VALID_BODY, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  test('WebAuthn の設定が無ければ本文を見る前に 503', async () => {
    vi.stubEnv('WEBAUTHN_ORIGIN', '')
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
    const res = await POST(verifyRequest({ label: 'x' }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  test('response.id が文字列でなければ 400', async () => {
    const res = await POST(verifyRequest({ response: { id: 42 } }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })
})

// 失敗の理由は区別せずに返す (どの credential ID が登録済みかを数えさせない)
describe('ログインの失敗', () => {
  test('知らない credential は 401 で、検証まで進まない', async () => {
    mocks.stored = null

    const res = await POST(verifyRequest(VALID_BODY))

    expect(await responseContract(res)).toEqual(jsonContract(401, LOGIN_FAILED))
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  test('検証が投げたら 401 (理由はログにだけ残す)', async () => {
    mocks.verify.mockRejectedValue(new Error('bad signature'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(verifyRequest(VALID_BODY))

    expect(await responseContract(res)).toEqual(jsonContract(401, LOGIN_FAILED))
    expect(consoleError).toHaveBeenCalled()
    expect(mocks.issueSession).not.toHaveBeenCalled()
  })

  test('検証が通らなければ 401', async () => {
    mocks.verify.mockResolvedValue({ verified: false })

    const res = await POST(verifyRequest(VALID_BODY))

    expect(await responseContract(res)).toEqual(jsonContract(401, LOGIN_FAILED))
    expect(mocks.issueSession).not.toHaveBeenCalled()
  })
})

describe('ログインの成功', () => {
  test('カウンタを進め、セッションを発行して Cookie を貼る', async () => {
    const res = await POST(verifyRequest(VALID_BODY, { 'sec-fetch-site': 'same-origin' }))

    expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ userName: 'tommie' })))
    expect(mocks.touchPasskey).toHaveBeenCalledWith('cred-1', 4)
    expect(mocks.issueSession).toHaveBeenCalledWith('tommie')
    // Expires は現在時刻から決まるので形だけ見る
    expect(res.headers.get('set-cookie')).toMatch(
      /^__Host-qr_session=issued-token; Path=\/; Expires=[^;]+; Max-Age=7776000; Secure; HttpOnly; SameSite=lax$/,
    )
  })

  // 署名は正しいのに入れない、にしない
  test('使用記録の更新に失敗してもログインは通す', async () => {
    mocks.touchPasskey.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(verifyRequest(VALID_BODY))

    expect(res.status).toBe(200)
    expect(mocks.issueSession).toHaveBeenCalledWith('tommie')
  })
})
