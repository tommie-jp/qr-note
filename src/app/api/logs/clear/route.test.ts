import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { POST as PostFn } from './route'

// ログ消去の口 (docs/30-ブラウザログ計画.md §7)。
// client-logs/route.test.ts と同じ流儀: next/headers を差し替え、
// 認証の判定そのものは本物を通す
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

function postRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/logs/clear', {
    method: 'POST',
    headers,
  })
}

async function seedLogs(): Promise<void> {
  const { pushBrowserLogs } = await import('@/lib/logging/buffer')
  pushBrowserLogs([{ level: 'warn', text: '調査対象の警告' }], 'iPhone')
}

beforeEach(async () => {
  mocks.sessionToken = mocks.validToken
  const { clearLogBuffer } = await import('@/lib/logging/buffer')
  clearLogBuffer()
})

describe('拒否系 (消す前に弾く)', () => {
  test('未ログインは 401 を返し、ログは消えない', async () => {
    // Arrange
    mocks.sessionToken = null
    await seedLogs()
    const POST = await importPost()
    const { recentLogs } = await import('@/lib/logging/buffer')

    // Act
    const res = await POST(postRequest())

    // Assert
    expect(res.status).toBe(401)
    expect(recentLogs()).toHaveLength(1)
  })

  test('クロスサイトからの呼び出しは 403 を返し、ログは消えない', async () => {
    // Arrange: 開けっ放しにすると第三者のページから調査中の証拠を消せてしまう
    await seedLogs()
    const POST = await importPost()
    const { recentLogs } = await import('@/lib/logging/buffer')

    // Act
    const res = await POST(postRequest({ 'sec-fetch-site': 'cross-site' }))

    // Assert
    expect(res.status).toBe(403)
    expect(recentLogs()).toHaveLength(1)
  })
})

test('サーバ・ブラウザ両方のログを消す', async () => {
  // Arrange
  await seedLogs()
  const POST = await importPost()
  const { recentLogs } = await import('@/lib/logging/buffer')
  expect(recentLogs()).toHaveLength(1)

  // Act
  const res = await POST(postRequest())

  // Assert
  expect(res.status).toBe(200)
  expect(recentLogs()).toHaveLength(0)
})
