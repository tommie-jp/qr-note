import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { issueSession } from '@/lib/auth/sessionStore'
import { SESSION_COOKIE_NAME } from '@/lib/auth/sessionToken'

// セッション発行は DB を叩くので差し替える。Basic 照合 (bcrypt) は本物を通す
// —— モックすると「資格情報が違っても通る」不具合が緑のまま隠れるため
vi.mock('@/lib/auth/sessionStore', () => ({ issueSession: vi.fn() }))

const issueSessionMock = vi.mocked(issueSession)

const PASSWORD = 'test-password'
// コスト 4 で作る (既定の 10 より速い。検算はハッシュ内のコストに従う)
const bcrypt = await import('bcryptjs')
const HASH_B64 = Buffer.from(bcrypt.default.hashSync(PASSWORD, 4), 'utf8').toString('base64')

function basicHeader(credentials: string): string {
  return `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`
}

function request(authorization: string | null, url = 'http://localhost/login'): NextRequest {
  return new NextRequest(url, {
    headers: authorization === null ? {} : { authorization },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BASIC_AUTH_USER = 'tommie'
  process.env.BASIC_AUTH_HASH_B64 = HASH_B64
  issueSessionMock.mockResolvedValue({
    token: 'issued-token',
    expiresAt: new Date('2026-10-17T00:00:00.000Z'),
  })
})

describe('GET /login without valid credentials', () => {
  test('asks the browser for credentials with 401', async () => {
    const response = await GET(request(null))

    expect(response.status).toBe(401)
    // このヘッダだけがブラウザの認証ダイアログを出せる
    expect(response.headers.get('WWW-Authenticate')).toContain('Basic')
  })

  test('does not issue a session', async () => {
    await GET(request(null))

    expect(issueSessionMock).not.toHaveBeenCalled()
  })

  test('does not set a session cookie', async () => {
    const response = await GET(request(null))

    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined()
  })

  test('rejects a wrong password', async () => {
    const response = await GET(request(basicHeader('tommie:wrong')))

    expect(response.status).toBe(401)
    expect(issueSessionMock).not.toHaveBeenCalled()
  })

  test('rejects an unknown user', async () => {
    const response = await GET(request(basicHeader('mallory:test-password')))

    expect(response.status).toBe(401)
    expect(issueSessionMock).not.toHaveBeenCalled()
  })

  // ダイアログを閉じるとブラウザはこのボディをそのまま画面に出す。
  // 行き止まりにしない (docs/18 §12)
  test('shows a way back when the visitor closes the dialog', async () => {
    const response = await GET(request(null, 'http://localhost/login?next=/item/4518'))

    expect(response.headers.get('Content-Type')).toContain('text/html')
    await expect(response.text()).resolves.toContain('href="/item/4518"')
  })

  test('sends the visitor back to the top page when there is no return target', async () => {
    const response = await GET(request(null))

    await expect(response.text()).resolves.toContain('href="/"')
  })

  test('still validates the return target on the way back', async () => {
    const response = await GET(request(null, 'http://localhost/login?next=//evil.example.com'))

    // 401 のボディも踏み台にしない
    const body = await response.text()
    expect(body).not.toContain('evil.example.com')
    expect(body).toContain('href="/"')
  })

  test('never lets the 401 be cached', async () => {
    const response = await GET(request(null))

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('GET /login with valid credentials', () => {
  test('issues a session for the user who logged in', async () => {
    await GET(request(basicHeader(`tommie:${PASSWORD}`)))

    expect(issueSessionMock).toHaveBeenCalledWith('tommie')
  })

  test('sets the session cookie so later requests need no header', async () => {
    const response = await GET(request(basicHeader(`tommie:${PASSWORD}`)))

    const cookie = response.cookies.get(SESSION_COOKIE_NAME)
    expect(cookie?.value).toBe('issued-token')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.secure).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
    expect(cookie?.path).toBe('/')
  })

  test('redirects to the requested page with 303', async () => {
    const response = await GET(
      request(basicHeader(`tommie:${PASSWORD}`), 'http://localhost/login?next=/item/4518'),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/item/4518')
  })

  test('still validates the redirect target', async () => {
    const response = await GET(
      request(basicHeader(`tommie:${PASSWORD}`), 'http://localhost/login?next=//evil.example.com'),
    )

    // 他所へ運ぶ踏み台にしない
    expect(response.headers.get('Location')).toBe('/')
  })

  test('never lets the response be cached', async () => {
    const response = await GET(request(basicHeader(`tommie:${PASSWORD}`)))

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
