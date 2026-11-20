import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BAD_REQUEST_MESSAGE } from '@/lib/route/parse'
import { SECRET_BATCH_MAX_BYTES, SECRET_BATCH_MAX_NAMES } from '@/lib/secret/search'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// シークレット内検索の材料の口 (docs/130-シークレット内検索計画.md §5-1)。
// 他の route テストと同じ流儀: next/headers とセッションの DB を差し替え、
// 門番と本文の検査は本物を通す。DB を引く層 (secret/textIndex) は偽物
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  entries: [] as unknown[],
  totalBytes: 0,
  blobs: [] as Array<{ name: string; data: Uint8Array }>,
  asked: [] as string[][],
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
      ? { userName: 'tommie', expiresAt: new Date('2099-01-01T00:00:00.000Z'), createdAt: new Date() }
      : null,
}))

vi.mock('@/lib/secret/textIndex', () => ({
  listSecretTexts: async () => mocks.entries,
  secretTextBytes: async () => mocks.totalBytes,
  findSecretTextBlobs: async (names: string[]) => {
    mocks.asked.push(names)
    return mocks.blobs
  },
}))

const { GET, POST } = await import('./route')

const URL = 'http://localhost/api/secret-texts'
const A = '0421547b-ee29-4613-a6d4-da0f41f94054'
const B = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const BAD_REQUEST = jsonContract(400, failEnvelope(BAD_REQUEST_MESSAGE))

function getRequest(headers: Record<string, string> = {}): Request {
  return new Request(URL, { method: 'GET', headers })
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.entries = []
  mocks.totalBytes = 0
  mocks.blobs = []
  mocks.asked = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('門番 (デモ → ログイン → クロスサイトの順)', () => {
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await GET(getRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
  })

  test('未ログインには一覧も暗号文も配らない (401)', async () => {
    mocks.sessionToken = null

    expect(await responseContract(await GET(getRequest()))).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
    expect(await responseContract(await POST(postRequest({ names: [A] })))).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
    expect(mocks.asked).toEqual([])
  })

  test('クロスサイトは 403', async () => {
    const res = await POST(postRequest({ names: [A] }, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.asked).toEqual([])
  })
})

describe('GET (一覧)', () => {
  test('一覧をそのまま、キャッシュさせずに返す', async () => {
    mocks.entries = [
      { name: A, hash: 'abc', bytes: 40, refs: [{ itemId: 'n1', title: '銀行', label: '口座' }] },
    ]

    const res = await GET(getRequest())

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ entries: mocks.entries })),
    )
  })
})

describe('POST (暗号文のまとめ取り)', () => {
  test('暗号文を base64 で返す', async () => {
    mocks.blobs = [{ name: A, data: new Uint8Array([1, 2, 3]) }]

    const res = await POST(postRequest({ names: [A, B] }))

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ blobs: [{ name: A, data: 'AQID' }] })),
    )
    expect(mocks.asked).toEqual([[A, B]])
  })

  test.each([
    ['JSON でない', 'not json'],
    ['names が無い', {}],
    ['names が配列でない', { names: A }],
    ['空の配列', { names: [] }],
    ['UUID でない名前', { names: [A, '../etc/passwd'] }],
    ['文字列でない名前', { names: [A, 1] }],
    ['重複', { names: [A, A] }],
    ['件数の上限超え', { names: Array.from({ length: SECRET_BATCH_MAX_NAMES + 1 }, () => A) }],
  ])('%s は 400 で、DB を引かない', async (_label, body) => {
    const res = await POST(postRequest(body))

    expect(await responseContract(res)).toEqual(BAD_REQUEST)
    expect(mocks.asked).toEqual([])
  })

  test('複数件で合計が上限を超えたら 413 (暗号文は読まない)', async () => {
    mocks.totalBytes = SECRET_BATCH_MAX_BYTES + 1

    const res = await POST(postRequest({ names: [A, B] }))

    expect(await responseContract(res)).toEqual(
      jsonContract(413, failEnvelope('一度に取れる大きさを超えています')),
    )
    expect(mocks.asked).toEqual([])
  })

  test('1 件だけなら上限より大きくても通す', async () => {
    mocks.totalBytes = SECRET_BATCH_MAX_BYTES + 1
    mocks.blobs = [{ name: A, data: new Uint8Array([9]) }]

    const res = await POST(postRequest({ names: [A] }))

    expect(res.status).toBe(200)
    expect(mocks.asked).toEqual([[A]])
  })
})
