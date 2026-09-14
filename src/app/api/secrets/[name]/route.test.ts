import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// シークレット断片の口 (docs/51-部分暗号化計画.md §10)。
// 他の route テストと同じ流儀: next/headers とセッションの DB を差し替え、
// 門番と本文の検査 (secret/route.ts) は本物を通す。保存 (secretStore) は偽物
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  stored: null as null | { mime: string; data: Uint8Array },
  saved: [] as Array<{ name: string; mime: string; bytes: Uint8Array }>,
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

vi.mock('@/lib/secret/store', () => ({
  findSecret: async () => mocks.stored,
  saveSecret: async (name: string, mime: string, bytes: Uint8Array) => {
    mocks.saved.push({ name, mime, bytes })
  },
}))

const { GET, PUT } = await import('./route')

const NAME = '0421547b-ee29-4613-a6d4-da0f41f94054'
const CIPHERTEXT = new Uint8Array([1, 2, 3, 4, 5])
const BAD_NAME = failEnvelope('不正なシークレット名です')

function secretRequest(
  method: 'GET' | 'PUT',
  name: string,
  { headers = {}, body }: { headers?: Record<string, string>; body?: BodyInit } = {},
): [Request, { params: Promise<{ name: string }> }] {
  return [
    new Request(`http://localhost/api/secrets/${name}`, { method, headers, body }),
    { params: Promise.resolve({ name }) },
  ]
}

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.stored = { mime: 'image/png', data: CIPHERTEXT }
  mocks.saved = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('門番 (デモ → ログイン → クロスサイトの順)', () => {
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await GET(...secretRequest('GET', NAME, { headers: { 'sec-fetch-site': 'cross-site' } }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
  })

  // 公開ノートに参照が書かれていても、未ログインには暗号文すら配らない
  test('未ログインはクロスサイト判定より先に 401', async () => {
    mocks.sessionToken = null

    const res = await GET(...secretRequest('GET', NAME, { headers: { 'sec-fetch-site': 'cross-site' } }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
  })

  test('クロスサイトは 403', async () => {
    const res = await PUT(...secretRequest('PUT', NAME, { headers: { 'sec-fetch-site': 'cross-site' } }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.saved).toEqual([])
  })
})

describe('GET (配信)', () => {
  test('UUID でない名前は 400', async () => {
    const res = await GET(...secretRequest('GET', '..%2Fetc'))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_NAME))
  })

  test('無ければ 404', async () => {
    mocks.stored = null

    const res = await GET(...secretRequest('GET', NAME))

    expect(await responseContract(res)).toEqual(
      jsonContract(404, failEnvelope('シークレットが見つかりません')),
    )
  })

  test('暗号文をそのまま、キャッシュさせずに配る (復号後の種別は別ヘッダ)', async () => {
    const res = await GET(...secretRequest('GET', NAME, { headers: { 'sec-fetch-site': 'same-origin' } }))

    expect(res.status).toBe(200)
    expect(Object.fromEntries(res.headers)).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'x-secret-mime': 'image/png',
    })
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CIPHERTEXT)
  })
})

describe('PUT (保存)', () => {
  const pngHeaders = { 'x-secret-mime': 'image/png', 'content-type': 'application/octet-stream' }

  test('UUID でない名前は本文を読む前に 400', async () => {
    const res = await PUT(...secretRequest('PUT', 'not-a-uuid', { headers: pngHeaders, body: CIPHERTEXT }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_NAME))
  })

  test('別オリジンからの送信は 403', async () => {
    const res = await PUT(
      ...secretRequest('PUT', NAME, {
        headers: { ...pngHeaders, origin: 'https://evil.example' },
        body: CIPHERTEXT,
      }),
    )

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスオリジンのアップロードは許可されていません')),
    )
  })

  test('シークレットにできない種別は 400', async () => {
    const res = await PUT(
      ...secretRequest('PUT', NAME, {
        headers: { 'x-secret-mime': 'text/html' },
        body: CIPHERTEXT,
      }),
    )

    expect(await responseContract(res)).toEqual(
      jsonContract(400, failEnvelope('この種類はシークレットにできません')),
    )
  })

  test('中身が空なら 400', async () => {
    const res = await PUT(...secretRequest('PUT', NAME, { headers: pngHeaders }))

    expect(await responseContract(res)).toEqual(jsonContract(400, failEnvelope('中身がありません')))
  })

  test('申告サイズが大きすぎれば本文を読まずに 413', async () => {
    const res = await PUT(
      ...secretRequest('PUT', NAME, {
        headers: { ...pngHeaders, 'content-length': String(1024 * 1024 * 1024) },
      }),
    )

    expect(res.status).toBe(413)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mocks.saved).toEqual([])
  })

  test('保存して名前を返す', async () => {
    const res = await PUT(
      ...secretRequest('PUT', NAME, {
        headers: { ...pngHeaders, 'sec-fetch-site': 'same-origin' },
        body: CIPHERTEXT,
      }),
    )

    expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ name: NAME })))
    expect(mocks.saved).toEqual([{ name: NAME, mime: 'image/png', bytes: CIPHERTEXT }])
  })
})
