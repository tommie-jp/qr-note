import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// 登録パターン (★) の口 (docs/59-検索候補計画.md §4, §7)。
// 呼び出しの記録は ../route.test.ts が持つ。こちらは応答の契約 (状態コード・
// Cache-Control・本文) と、門番 searchQueryUser の判定順を押さえる
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  registerFull: false,
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

vi.mock('@/lib/searchQueryStore', () => ({
  registerSaved: async (_user: string, query: string) =>
    mocks.registerFull ? null : { saved: [query], recent: [] },
  unregisterSaved: async (_user: string, query: string) => ({ saved: [], recent: [query] }),
}))

const { PUT, DELETE } = await import('./route')

function savedRequest(
  method: 'PUT' | 'DELETE',
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/search-queries/saved', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const BAD_REQUEST = failEnvelope('リクエストの形式が正しくありません')

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.registerFull = false
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('門番 (ログイン → クロスサイト → デモの順)', () => {
  test('未ログインはデモでもクロスサイトでも 401', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await PUT(savedRequest('PUT', { query: 'a' }, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
  })

  test('クロスサイトはデモでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')

    const res = await DELETE(
      savedRequest('DELETE', { query: 'a' }, { 'sec-fetch-site': 'cross-site' }),
    )

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
  })

  // 共有アカウントなので覚えない。403 にすると画面がエラーを抱える
  test('デモは本文を見ずに空のリストを返す', async () => {
    vi.stubEnv('DEMO_MODE', '1')

    const res = await PUT(savedRequest('PUT', '{'))

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ saved: [], recent: [] })),
    )
  })
})

describe('PUT (登録)', () => {
  test('壊れた JSON は 400', async () => {
    const res = await PUT(savedRequest('PUT', '{'))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  test('query が無ければ 400', async () => {
    const res = await PUT(savedRequest('PUT', {}))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  test('登録後のリストを返す', async () => {
    const res = await PUT(savedRequest('PUT', { query: 'is:todo' }, { 'sec-fetch-site': 'same-origin' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ saved: ['is:todo'], recent: [] })),
    )
  })

  test('満杯なら 409', async () => {
    mocks.registerFull = true

    const res = await PUT(savedRequest('PUT', { query: 'is:todo' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(409, failEnvelope('登録パターンは 10 件までです')),
    )
  })
})

describe('DELETE (解除)', () => {
  test('query が文字列でなければ 400', async () => {
    const res = await DELETE(savedRequest('DELETE', { query: 7 }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  test('解除後のリストを返す', async () => {
    const res = await DELETE(savedRequest('DELETE', { query: 'is:todo' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ saved: [], recent: ['is:todo'] })),
    )
  })
})
