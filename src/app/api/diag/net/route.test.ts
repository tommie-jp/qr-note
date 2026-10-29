import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// 回線の計測の口 (docs/121 §4-1)。api/logs/perf と同じ流儀: next/headers と
// セッションの DB を差し替え、門番の判定そのものは本物を通す
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

const { GET, POST, MAX_DOWNLOAD_BYTES, MAX_UPLOAD_BYTES } = await import('./route')

const get = (query: string) => GET(new Request(`http://localhost/api/diag/net${query}`))
const post = (body: Uint8Array<ArrayBuffer>) =>
  POST(new Request('http://localhost/api/diag/net', { method: 'POST', body }))

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET', () => {
  test('size バイトの octet-stream を溜めずに返す', async () => {
    const res = await get('?size=1024')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.arrayBuffer()).byteLength).toBe(1024)
  })

  test('size=0 は空の本文 (往復の計測)', async () => {
    const res = await get('?size=0')

    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })

  test('上限を超える size・整数でない size は 400', async () => {
    expect((await get(`?size=${MAX_DOWNLOAD_BYTES + 1}`)).status).toBe(400)
    expect((await get('?size=1.5')).status).toBe(400)
    expect((await get('?size=-1')).status).toBe(400)
  })

  test('未ログインは 401', async () => {
    mocks.sessionToken = null

    expect((await get('?size=0')).status).toBe(401)
  })

  test('デモでは断る', async () => {
    vi.stubEnv('DEMO_MODE', '1')

    expect((await get('?size=0')).status).not.toBe(200)
  })
})

describe('POST', () => {
  test('受け取ったバイト数を返す', async () => {
    const res = await post(new Uint8Array(4096))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, data: { bytes: 4096 } })
  })

  test('上限を超える本文は 413', async () => {
    const res = await post(new Uint8Array(MAX_UPLOAD_BYTES + 1))

    expect(res.status).toBe(413)
  })
})
