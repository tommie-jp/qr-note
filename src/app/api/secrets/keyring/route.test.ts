import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { bytesToBase64 } from '@/lib/bytesBase64'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// 鍵束の口 (docs/51-部分暗号化計画.md §6)。
// 他の route テストと同じ流儀: next/headers とセッションの DB を差し替え、
// 門番の判定そのものは本物を通す。鍵束の保存 (secretStore) は偽物にして、
// 本文の検算と「どの順で何を呼ぶか」を見る
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  verifier: null as Uint8Array | null,
  wraps: [] as Array<{ credentialId: string; label: string; wrapped: Uint8Array | null }>,
  knownCredential: true,
  initOk: true,
  saveWrapOk: true,
  calls: [] as string[],
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

vi.mock('@/lib/secretStore', () => ({
  findKeyringVerifier: async () => mocks.verifier,
  listKeyWraps: async () => mocks.wraps,
  hasCredential: async (id: string) => {
    mocks.calls.push(`hasCredential:${id}`)
    return mocks.knownCredential
  },
  initKeyring: async () => {
    mocks.calls.push('initKeyring')
    return mocks.initOk
  },
  saveKeyWrap: async (id: string) => {
    mocks.calls.push(`saveKeyWrap:${id}`)
    return mocks.saveWrapOk
  },
  deleteKeyring: async () => {
    mocks.calls.push('deleteKeyring')
  },
}))

const { GET, POST, PUT } = await import('./route')

const URL_KEYRING = 'http://localhost/api/secrets/keyring'
const BAD_REQUEST = failEnvelope('リクエストの形式が正しくありません')
const KEY = new Uint8Array(32).fill(7)
const KEY_B64 = bytesToBase64(KEY)

function keyringRequest(
  method: 'GET' | 'POST' | 'PUT',
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(URL_KEYRING, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.verifier = null
  mocks.wraps = []
  mocks.knownCredential = true
  mocks.initOk = true
  mocks.saveWrapOk = true
  mocks.calls = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('門番 (デモ → ログイン → クロスサイトの順)', () => {
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await GET(keyringRequest('GET', undefined, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
  })

  test('未ログインはクロスサイト判定より先に 401', async () => {
    mocks.sessionToken = null

    const res = await POST(
      keyringRequest('POST', { verifier: KEY_B64 }, { 'sec-fetch-site': 'cross-site' }),
    )

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
    expect(mocks.calls).toEqual([])
  })

  test('クロスサイトは 403', async () => {
    const res = await PUT(keyringRequest('PUT', {}, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
  })
})

describe('GET', () => {
  test('未設定なら initialized: false と空の一覧', async () => {
    const res = await GET(keyringRequest('GET'))

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ initialized: false, verifier: null, wraps: [] })),
    )
  })

  test('検証値と包みを base64 で返す (まだ包んでいないパスキーは null)', async () => {
    mocks.verifier = KEY
    mocks.wraps = [
      { credentialId: 'cred-1', label: 'iPhone', wrapped: KEY },
      { credentialId: 'cred-2', label: 'Mac', wrapped: null },
    ]

    const res = await GET(keyringRequest('GET', undefined, { 'sec-fetch-site': 'same-origin' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(
        200,
        okEnvelope({
          initialized: true,
          verifier: KEY_B64,
          wraps: [
            { credentialId: 'cred-1', label: 'iPhone', wrapped: KEY_B64 },
            { credentialId: 'cred-2', label: 'Mac', wrapped: null },
          ],
        }),
      ),
    )
  })
})

describe('POST (初回設定)', () => {
  const VALID = { verifier: KEY_B64, credentialId: 'cred-1', wrapped: KEY_B64 }

  test('壊れた JSON は 400', async () => {
    const res = await POST(keyringRequest('POST', '{'))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  test('検証値が無ければ 400', async () => {
    const res = await POST(keyringRequest('POST', { ...VALID, verifier: '' }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
    expect(mocks.calls).toEqual([])
  })

  test('鍵材料が長すぎれば 400 (溜め込まない)', async () => {
    const res = await POST(
      keyringRequest('POST', { ...VALID, wrapped: bytesToBase64(new Uint8Array(257)) }),
    )

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  test('知らないパスキーなら鍵束を作らずに 404', async () => {
    mocks.knownCredential = false

    const res = await POST(keyringRequest('POST', VALID))

    expect(await responseContract(res)).toEqual(
      jsonContract(404, failEnvelope('そのパスキーは登録されていません')),
    )
    expect(mocks.calls).toEqual(['hasCredential:cred-1'])
  })

  test('設定済みなら 409', async () => {
    mocks.initOk = false

    const res = await POST(keyringRequest('POST', VALID))

    expect(await responseContract(res)).toEqual(
      jsonContract(409, failEnvelope('暗号化は既に設定されています')),
    )
  })

  test('包みを保存できなければ鍵束を畳んで 404', async () => {
    mocks.saveWrapOk = false

    const res = await POST(keyringRequest('POST', VALID))

    expect(await responseContract(res)).toEqual(
      jsonContract(404, failEnvelope('そのパスキーは登録されていません')),
    )
    expect(mocks.calls).toEqual([
      'hasCredential:cred-1',
      'initKeyring',
      'saveKeyWrap:cred-1',
      'deleteKeyring',
    ])
  })

  test('設定できたら initialized: true', async () => {
    const res = await POST(keyringRequest('POST', VALID, { 'sec-fetch-site': 'same-origin' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ initialized: true })),
    )
    expect(mocks.calls).toEqual(['hasCredential:cred-1', 'initKeyring', 'saveKeyWrap:cred-1'])
  })
})

describe('PUT (包みを足す)', () => {
  const VALID = { credentialId: 'cred-2', wrapped: KEY_B64 }

  test('credentialId が無ければ 400', async () => {
    const res = await PUT(keyringRequest('PUT', { wrapped: KEY_B64 }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  test('鍵束が無ければ 409', async () => {
    const res = await PUT(keyringRequest('PUT', VALID))

    expect(await responseContract(res)).toEqual(
      jsonContract(409, failEnvelope('先に暗号化を設定してください')),
    )
    expect(mocks.calls).toEqual([])
  })

  test('知らないパスキーなら 404', async () => {
    mocks.verifier = KEY
    mocks.saveWrapOk = false

    const res = await PUT(keyringRequest('PUT', VALID))

    expect(await responseContract(res)).toEqual(
      jsonContract(404, failEnvelope('そのパスキーは登録されていません')),
    )
  })

  test('足せたら initialized: true', async () => {
    mocks.verifier = KEY

    const res = await PUT(keyringRequest('PUT', VALID))

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ initialized: true })),
    )
    expect(mocks.calls).toEqual(['saveKeyWrap:cred-2'])
  })
})
