import { beforeEach, describe, expect, test, vi } from 'vitest'
import { loadMonthEvents } from './calendarQuery'

// GET /api/calendar (docs/126 §1-3)。items の口のテストと同じ流儀: セッションだけを
// 差し替えて門番は本物を通し、DB を引く所 (calendarQuery) は偽物にする
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
}))

vi.mock('next/headers', async () => {
  const { SESSION_COOKIE_NAME } = await import('@/lib/auth/sessionToken')
  return {
    headers: async () => new Headers(),
    cookies: async () => ({
      get: (name: string) =>
        name === SESSION_COOKIE_NAME && mocks.sessionToken !== null ? { name, value: mocks.sessionToken } : undefined,
    }),
  }
})
vi.mock('@/lib/auth/sessionStore', () => ({
  findActiveSession: async (token: string) =>
    token === mocks.validToken
      ? { userName: 'tommie', expiresAt: new Date('2099-01-01T00:00:00.000Z'), createdAt: new Date() }
      : null,
}))
vi.mock('./calendarQuery', () => ({ loadMonthEvents: vi.fn() }))

const { GET } = await import('./route')

const PAYLOAD = {
  events: [{ itemId: 'a', title: '歯医者', start: '2026-11-05T01:00:00.000Z', end: '2026-11-05T02:00:00.000Z', allDay: false }],
  omitted: 0,
}

const request = (query: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/calendar${query}`, { headers })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sessionToken = mocks.validToken
  vi.mocked(loadMonthEvents).mockResolvedValue(PAYLOAD)
})

describe('GET /api/calendar', () => {
  test('検索式と月で引き、封筒で返す', async () => {
    const res = await GET(request('?q=%20%23予定%20&month=2026-11'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: PAYLOAD, error: null })
    expect(loadMonthEvents).toHaveBeenCalledWith('#予定', '2026-11')
  })

  test('未ログインは 401 で、DB まで届かない', async () => {
    mocks.sessionToken = null

    const res = await GET(request('?month=2026-11'))

    expect(res.status).toBe(401)
    expect(loadMonthEvents).not.toHaveBeenCalled()
  })

  test('クロスサイトからは 403', async () => {
    const res = await GET(request('?month=2026-11', { 'sec-fetch-site': 'cross-site' }))

    expect(res.status).toBe(403)
  })

  test.each([['月が無い', ''], ['月の形が違う', '?month=2026-1'], ['13 月', '?month=2026-13'], ['検索式が長すぎる', `?month=2026-11&q=${'a'.repeat(1001)}`]])(
    '%s なら 400',
    async (_label, query) => {
      const res = await GET(request(query))

      expect(res.status).toBe(400)
      expect(loadMonthEvents).not.toHaveBeenCalled()
    },
  )
})
