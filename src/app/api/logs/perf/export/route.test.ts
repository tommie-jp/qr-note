import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// 計測ログの取得口 (docs/120 §3)。鍵の照合と控えを差し替える
const mocks = vi.hoisted(() => ({ owner: null as string | null }))

vi.mock('@/lib/logging/perfExportToken', () => ({
  perfExportOwner: async (token: string) => (token === 'good-token' ? mocks.owner : null),
}))

// 門番 (route/guard.ts) がセッションの DB を引き込むが、この口はログインを見ない
vi.mock('@/lib/db', () => ({ prisma: {} }))

vi.mock('@/lib/logging/buffer', () => ({
  recentPerfLines: () => [
    {
      at: new Date('2026-10-28T12:00:00.000Z'),
      level: 'info',
      source: 'server',
      text: '[計測] 検索/サーバ q="抵抗"',
      kind: 'perf',
    },
  ],
}))

const { GET } = await import('./route')

function getRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/logs/perf/export', { headers })
}

beforeEach(() => {
  mocks.owner = 'tommie'
})

afterEach(() => vi.unstubAllEnvs())

describe('拒否系', () => {
  test('鍵が無ければ 401', async () => {
    const res = await GET(getRequest())
    expect(res.status).toBe(401)
  })

  test('鍵が違えば 401', async () => {
    const res = await GET(getRequest({ Authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
  })

  test('Bearer 以外の形は 401', async () => {
    const res = await GET(getRequest({ Authorization: 'Basic good-token' }))
    expect(res.status).toBe(401)
  })

  test('デモでも鍵が無ければ 401 (デモかどうかを教えない)', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    const res = await GET(getRequest())
    expect(res.status).toBe(401)
  })

  test('デモは鍵があっても 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    const res = await GET(getRequest({ Authorization: 'Bearer good-token' }))
    expect(res.status).toBe(403)
  })
})

test('正しい鍵なら計測行を素のテキストで返す', async () => {
  const res = await GET(getRequest({ Authorization: 'Bearer good-token' }))

  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toContain('text/plain')
  expect(res.headers.get('Cache-Control')).toBe('no-store')
  expect(await res.text()).toContain('サーバ [計測] 検索/サーバ q="抵抗"')
})
