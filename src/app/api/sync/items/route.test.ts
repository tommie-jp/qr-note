import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// オフライン用にノートをまるごと持ち出す口 (docs/65-オフライン対応計画.md §1)。
// 他の route テストと同じ流儀: next/headers とセッションの DB を差し替え、
// 門番の判定そのものは本物を通す。持ち出す中身 (syncItems) は偽物
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  loads: 0,
  payload: { syncedAt: '2026-09-13T00:00:00.000Z', items: [], circuits: [] },
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

vi.mock('@/lib/offline/syncItems', () => ({
  loadOfflineSyncPayload: async () => {
    mocks.loads += 1
    return mocks.payload
  },
}))

const { GET } = await import('./route')

function syncRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/sync/items', { headers })
}

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.loads = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('拒否系 (読み出す前に弾く)', () => {
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await GET(syncRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
    expect(mocks.loads).toBe(0)
  })

  // Service Worker が「同期の失敗」と分かるよう、未ログインは必ず 401
  test('未ログインはクロスサイト判定より先に 401', async () => {
    mocks.sessionToken = null

    const res = await GET(syncRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
    expect(mocks.loads).toBe(0)
  })

  test('クロスサイトは 403', async () => {
    const res = await GET(syncRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.loads).toBe(0)
  })
})

// 中間キャッシュに持たれると、別の端末で足したノートがいつまでも届かない
test('中身をキャッシュさせずに返す', async () => {
  const res = await GET(syncRequest({ 'sec-fetch-site': 'same-origin' }))

  expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope(mocks.payload)))
  expect(mocks.loads).toBe(1)
})
