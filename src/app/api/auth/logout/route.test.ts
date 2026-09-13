import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// ログアウトの口 (docs/29-パスキー計画.md §4)。
// 他の route テストと同じ流儀: next/headers とセッションの DB だけを差し替え、
// クロスサイトの判定そのものは本物を通す
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  destroyed: [] as Array<string | null>,
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
  findActiveSession: async () => null,
  destroySession: async (token: string | null) => {
    mocks.destroyed.push(token)
  },
}))

const { POST } = await import('./route')

function logoutRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/logout', { method: 'POST', headers })
}

beforeEach(() => {
  mocks.sessionToken = 'some-session-token'
  mocks.destroyed = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('拒否系', () => {
  test('クロスサイトからの呼び出しは 403 で、セッションに触らない', async () => {
    const res = await POST(logoutRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.destroyed).toEqual([])
  })
})

describe('ログアウト', () => {
  test('セッション行を消し、Cookie を即時失効させる', async () => {
    const res = await POST(logoutRequest({ 'sec-fetch-site': 'same-origin' }))

    expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ loggedOut: true })))
    expect(mocks.destroyed).toEqual(['some-session-token'])
    expect(res.headers.get('set-cookie')).toBe(
      '__Host-qr_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=lax',
    )
  })

  // 既に切れているセッションで押されても「ログアウトできない」にしない
  test('Cookie が無くても 200 (ログイン検査はしない)', async () => {
    mocks.sessionToken = null

    const res = await POST(logoutRequest())

    expect(res.status).toBe(200)
    expect(mocks.destroyed).toEqual([null])
  })

  test('デモでも断らない', async () => {
    vi.stubEnv('DEMO_MODE', '1')

    const res = await POST(logoutRequest())

    expect(res.status).toBe(200)
  })
})
