import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// 登録済みパスキーを 1 つ消す口 (docs/29-パスキー計画.md §6, §8)。
// 他の route テストと同じ流儀: next/headers とセッション・パスキーの DB だけを
// 差し替え、門番の判定そのものは本物を通す
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  deleted: [] as string[],
  exists: true,
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
  deletePasskey: async (id: string) => {
    mocks.deleted.push(id)
    return mocks.exists
  },
}))

const { DELETE } = await import('./route')

function deleteRequest(
  id: string,
  headers: Record<string, string> = {},
): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/auth/passkeys/${id}`, { method: 'DELETE', headers }),
    { params: Promise.resolve({ id }) },
  ]
}

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.deleted = []
  mocks.exists = true
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('拒否系 (消す前に弾く)', () => {
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await DELETE(...deleteRequest('cred-1', { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
    expect(mocks.deleted).toEqual([])
  })

  test('未ログインはクロスサイト判定より先に 401', async () => {
    mocks.sessionToken = null

    const res = await DELETE(...deleteRequest('cred-1', { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
    expect(mocks.deleted).toEqual([])
  })

  test('クロスサイトは 403', async () => {
    const res = await DELETE(...deleteRequest('cred-1', { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.deleted).toEqual([])
  })
})

describe('削除', () => {
  test('無ければ 404', async () => {
    mocks.exists = false

    const res = await DELETE(...deleteRequest('cred-unknown'))

    expect(await responseContract(res)).toEqual(
      jsonContract(404, failEnvelope('そのパスキーは見つかりませんでした')),
    )
  })

  test('消した ID を返す', async () => {
    const res = await DELETE(...deleteRequest('cred-1', { 'sec-fetch-site': 'same-origin' }))

    expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ id: 'cred-1' })))
    expect(mocks.deleted).toEqual(['cred-1'])
  })
})
