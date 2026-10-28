import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setPerfLogEnabled, isPerfLogEnabled } from '@/lib/logging/perfSwitch'

// 速度計測の切替の口 (docs/119 §1-4)。消去の口 (api/logs/clear) と同じ流儀:
// next/headers とセッションの DB を差し替え、門番の判定そのものは本物を通す
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

const { POST } = await import('./route')

function postRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/logs/perf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
}

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  setPerfLogEnabled(false)
})

afterEach(() => {
  setPerfLogEnabled(false)
  vi.unstubAllEnvs()
})

describe('拒否系 (切り替える前に弾く)', () => {
  test('未ログインは 401 で、切替は変わらない', async () => {
    mocks.sessionToken = null
    const res = await POST(postRequest('{"enabled":true}'))
    expect(res.status).toBe(401)
    expect(isPerfLogEnabled()).toBe(false)
  })

  test('クロスサイトは 403', async () => {
    const res = await POST(postRequest('{"enabled":true}', { 'sec-fetch-site': 'cross-site' }))
    expect(res.status).toBe(403)
    expect(isPerfLogEnabled()).toBe(false)
  })

  test('デモは 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    const res = await POST(postRequest('{"enabled":true}'))
    expect(res.status).toBe(403)
    expect(isPerfLogEnabled()).toBe(false)
  })

  test.each(['not json', '{}', '{"enabled":"yes"}', 'null'])('形が違う本文は 400 (%s)', async (body) => {
    const res = await POST(postRequest(body))
    expect(res.status).toBe(400)
    expect(isPerfLogEnabled()).toBe(false)
  })
})

test('始めて、止める', async () => {
  const on = await POST(postRequest('{"enabled":true}'))
  expect(on.status).toBe(200)
  expect(await on.json()).toEqual({ success: true, data: { enabled: true }, error: null })
  expect(isPerfLogEnabled()).toBe(true)

  await POST(postRequest('{"enabled":false}'))
  expect(isPerfLogEnabled()).toBe(false)
})
