import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveSession, resolveUser } from './requestAuth'
import { findActiveSession } from './sessionStore'

vi.mock('./sessionStore', () => ({ findActiveSession: vi.fn() }))

const findActiveSessionMock = vi.mocked(findActiveSession)

const EXPIRES_AT = new Date('2026-10-17T00:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  findActiveSessionMock.mockResolvedValue(null)
})

describe('resolveSession', () => {
  test('returns the user behind a valid session cookie', async () => {
    findActiveSessionMock.mockResolvedValue({ userName: 'tommie', expiresAt: EXPIRES_AT })

    expect(await resolveSession('token')).toEqual({
      userName: 'tommie',
      expiresAt: EXPIRES_AT,
    })
  })

  test('returns null when the cookie is unknown or expired', async () => {
    expect(await resolveSession('stale-token')).toBe(null)
  })

  test('returns null when there is no cookie at all', async () => {
    expect(await resolveSession(null)).toBe(null)
  })

  test('does not hit the database for an empty cookie value', async () => {
    await resolveSession('')

    expect(findActiveSessionMock).not.toHaveBeenCalled()
  })

  test('returns null when the session lookup fails (DB down), never a user', async () => {
    findActiveSessionMock.mockRejectedValue(new Error('connection refused'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 認証できないものは未ログインに倒す。DB が死んでいるあいだ入れないのは
    // 承知のうえ (中身も読めない以上、実害は無い)
    expect(await resolveSession('token')).toBe(null)
    // 握りつぶさない
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})

describe('resolveUser', () => {
  test('returns just the name for callers that need nothing else', async () => {
    findActiveSessionMock.mockResolvedValue({ userName: 'tommie', expiresAt: EXPIRES_AT })

    expect(await resolveUser('token')).toBe('tommie')
  })

  test('returns null when nobody is logged in', async () => {
    expect(await resolveUser(null)).toBe(null)
  })
})

describe('the Authorization header is no longer an authentication path', () => {
  // ここが今回の変更の要。Basic ヘッダはブラウザが毎リクエスト自動で
  // 付け直すため、これを認証として受け付けている限りログアウトが成立しない
  // (サーバが何を消しても次のリクエストで復活する。docs/18 §11)。
  // 資格情報を検証してよいのは /login だけ。
  const BASIC_HEADER = `Basic ${Buffer.from('tommie:secret', 'utf8').toString('base64')}`

  test('resolveSession takes no header argument and ignores extra arguments', async () => {
    // 引数として渡されても認証には一切使われない
    const resolve = resolveSession as (...args: unknown[]) => Promise<unknown>

    expect(await resolve(null, BASIC_HEADER)).toBe(null)
  })

  test('a valid-looking Basic header alone never authenticates', async () => {
    const resolve = resolveUser as (...args: unknown[]) => Promise<unknown>

    expect(await resolve(null, BASIC_HEADER)).toBe(null)
  })
})
