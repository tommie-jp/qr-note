import { brotliDecompressSync } from 'node:zlib'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// 回路図の SVG を配る口 (docs/124 §1)。門番 (ログイン・クロスサイト) は本物を
// 通し、DB だけを差し替える
const mocks = vi.hoisted(() => ({
  sessionToken: 'valid' as string | null,
  findUnique: vi.fn(),
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
    token === 'valid' ? { userName: 'tommie', expiresAt: new Date('2099-01-01T00:00:00.000Z') } : null,
}))
vi.mock('@/lib/db', () => ({
  prisma: { circuitSvg: { findUnique: (...args: unknown[]) => mocks.findUnique(...args) } },
}))

const { GET } = await import('./route')

const HASH = 'a'.repeat(64)
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${'<path d="M0 0h10"/>'.repeat(80)}</svg>`

function call(hash: string, headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/api/circuits/svg/${hash}`, { headers }), {
    params: Promise.resolve({ hash }),
  })
}

beforeEach(() => {
  mocks.sessionToken = 'valid'
  mocks.findUnique.mockReset()
  mocks.findUnique.mockResolvedValue({ svg: SVG })
})

describe('GET /api/circuits/svg/:hash', () => {
  test('SVG を immutable で返し、スクリプトを止める見出しを付ける', async () => {
    // Act
    const res = await call(HASH)

    // Assert
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(await res.text()).toBe(SVG)
  })

  test('br を受ける相手には brotli で返す', async () => {
    // Act
    const res = await call(HASH, { 'accept-encoding': 'gzip, br' })

    // Assert
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(brotliDecompressSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(SVG)
  })

  test('未ログインは 401 で、DB を引かない', async () => {
    // Arrange
    mocks.sessionToken = null

    // Act
    const res = await call(HASH)

    // Assert
    expect(res.status).toBe(401)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  test('第三者のページからの読み込みは 403', async () => {
    // Act / Assert
    expect((await call(HASH, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  })

  test.each([['短い', 'abc'], ['大文字', 'A'.repeat(64)], ['道を辿る', '..%2F..%2Fetc']])(
    'hash の形が違えば 400: %s',
    async (_label, hash) => {
      // Act
      const res = await call(hash)

      // Assert
      expect(res.status).toBe(400)
      expect(mocks.findUnique).not.toHaveBeenCalled()
    },
  )

  test('未描画は 404 で、覚えさせない', async () => {
    // Arrange
    mocks.findUnique.mockResolvedValue(null)

    // Act
    const res = await call(HASH)

    // Assert
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  test('安全検査に通らない SVG は配らない', async () => {
    // Arrange
    mocks.findUnique.mockResolvedValue({ svg: '<svg><script>alert(1)</script></svg>' })

    // Act / Assert
    expect((await call(HASH)).status).toBe(404)
  })

  test('DB の失敗は 500 の定型文', async () => {
    // Arrange
    mocks.findUnique.mockRejectedValue(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Act
    const res = await call(HASH)

    // Assert
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('回路図を読み込めませんでした')
  })
})
