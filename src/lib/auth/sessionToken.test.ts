import { describe, expect, test } from 'vitest'
import {
  createSessionToken,
  hashSessionToken,
  sessionExpiresAt,
  SESSION_RENEW_AFTER_MS,
  SESSION_TTL_MS,
  shouldRenewSession,
} from './sessionToken'

describe('createSessionToken', () => {
  test('returns a different token every time', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => createSessionToken()))
    expect(tokens.size).toBe(100)
  })

  test('returns at least 256 bits worth of base64url characters', () => {
    // 32 バイトを base64url にすると 43 文字 (パディング無し)
    expect(createSessionToken().length).toBeGreaterThanOrEqual(43)
  })

  test('uses only URL-safe characters so it survives a cookie value', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(createSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})

describe('hashSessionToken', () => {
  test('returns the same hash for the same token', () => {
    const token = createSessionToken()
    expect(hashSessionToken(token)).toBe(hashSessionToken(token))
  })

  test('returns a different hash for a different token', () => {
    expect(hashSessionToken('a')).not.toBe(hashSessionToken('b'))
  })

  test('returns 64 hex characters (sha256)', () => {
    expect(hashSessionToken(createSessionToken())).toMatch(/^[0-9a-f]{64}$/)
  })

  test('never returns the token itself (the DB must not hold the raw value)', () => {
    const token = createSessionToken()
    expect(hashSessionToken(token)).not.toBe(token)
  })
})

describe('sessionExpiresAt', () => {
  test('expires 90 days after issue', () => {
    const now = new Date('2026-07-19T00:00:00.000Z')
    expect(sessionExpiresAt(now).toISOString()).toBe('2026-10-17T00:00:00.000Z')
  })

  test('does not mutate the date it was given', () => {
    const now = new Date('2026-07-19T00:00:00.000Z')
    sessionExpiresAt(now)
    expect(now.toISOString()).toBe('2026-07-19T00:00:00.000Z')
  })
})

describe('shouldRenewSession', () => {
  const now = new Date('2026-07-19T00:00:00.000Z')

  function expiresIn(ms: number): Date {
    return new Date(now.getTime() + ms)
  }

  test('does not renew a session issued moments ago', () => {
    expect(shouldRenewSession(expiresIn(SESSION_TTL_MS), now)).toBe(false)
  })

  test('does not renew until the renewal interval has passed', () => {
    const justUnderADayOld = expiresIn(SESSION_TTL_MS - SESSION_RENEW_AFTER_MS + 1000)
    expect(shouldRenewSession(justUnderADayOld, now)).toBe(false)
  })

  test('renews once the session is older than the renewal interval', () => {
    const justOverADayOld = expiresIn(SESSION_TTL_MS - SESSION_RENEW_AFTER_MS - 1000)
    expect(shouldRenewSession(justOverADayOld, now)).toBe(true)
  })

  test('renews a session that is close to expiring', () => {
    expect(shouldRenewSession(expiresIn(60_000), now)).toBe(true)
  })
})
