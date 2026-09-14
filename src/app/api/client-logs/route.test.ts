import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { POST as PostFn } from './route'

// ブラウザログの受け口 (docs/30-ブラウザログ計画.md §5)。
// image-search/index/route.test.ts と同じ流儀: route を関数として直接呼ぶため
// next/headers を差し替え、認証の判定そのものは本物を通す
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

async function importPost(): Promise<typeof PostFn> {
  const mod = await import('./route')
  return mod.POST
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/client-logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const validBody = { items: [{ level: 'warn', text: 'モデルを読み込めませんでした' }] }

beforeEach(async () => {
  mocks.sessionToken = mocks.validToken
  const { clearLogBuffer } = await import('@/lib/logBuffer')
  clearLogBuffer()
})

afterEach(async () => {
  const { clearLogBuffer } = await import('@/lib/logBuffer')
  clearLogBuffer()
})

describe('拒否系 (バッファに触れる前に弾く)', () => {
  test('未ログインは 401 を返す', async () => {
    mocks.sessionToken = null
    const POST = await importPost()

    const res = await POST(postRequest(validBody))

    expect(res.status).toBe(401)
  })

  test('クロスサイトからの呼び出しは 403 を返す', async () => {
    // 開けっ放しにすると、第三者のページからログイン済みのブラウザを使って
    // バッファを埋め、本物の警告を押し流せる
    const POST = await importPost()

    const res = await POST(postRequest(validBody, { 'sec-fetch-site': 'cross-site' }))

    expect(res.status).toBe(403)
  })

  test('JSON にならない本文は 400 (投げて 500 にしない)', async () => {
    const POST = await importPost()

    const res = await POST(postRequest('これは JSON ではない'))

    expect(res.status).toBe(400)
  })

  test('形の違う本文は 400', async () => {
    const POST = await importPost()

    const res = await POST(postRequest({ items: [{ level: 'debug', text: 'ログ' }] }))

    expect(res.status).toBe(400)
  })
})

test('受け取ったログはバッファに入り、/logs から読める', async () => {
  const POST = await importPost()
  const { recentLogs } = await import('@/lib/logBuffer')

  const res = await POST(
    postRequest(validBody, {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)',
    }),
  )

  expect(res.status).toBe(200)
  const [entry] = recentLogs()
  expect(entry.source).toBe('browser')
  expect(entry.level).toBe('warn')
  expect(entry.text).toBe('モデルを読み込めませんでした')
  // どの端末の悲鳴かが分かること
  expect(entry.device).toBe('iPhone')
})
