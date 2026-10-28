import { beforeEach, describe, expect, test, vi } from 'vitest'

// 取得鍵の発行口 (docs/120 §3)。門番は本物、発行だけ差し替える
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  issuedFor: [] as string[],
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

vi.mock('@/lib/logging/perfExportToken', () => ({
  issuePerfExportToken: async (user: string) => {
    mocks.issuedFor.push(user)
    return 'new-token'
  },
}))

const { POST } = await import('./route')

const postRequest = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/logs/perf/token', { method: 'POST', headers })

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.issuedFor = []
  vi.unstubAllEnvs()
})

describe('拒否系 (発行しない)', () => {
  test('未ログインは 401', async () => {
    mocks.sessionToken = null
    expect((await POST(postRequest())).status).toBe(401)
    expect(mocks.issuedFor).toEqual([])
  })

  test('クロスサイトは 403', async () => {
    expect((await POST(postRequest({ 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(mocks.issuedFor).toEqual([])
  })

  test('デモは 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    expect((await POST(postRequest())).status).toBe(403)
    expect(mocks.issuedFor).toEqual([])
  })
})

test('ログイン中の本人の鍵を発行して返す', async () => {
  const res = await POST(postRequest())

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ success: true, data: { token: 'new-token' }, error: null })
  expect(mocks.issuedFor).toEqual(['tommie'])
  expect(res.headers.get('Cache-Control')).toBe('no-store')
})
