import { describe, expect, test } from 'vitest'
import { isRecentLogin, RECENT_LOGIN_MAX_AGE_MS } from './stepUp'

const NOW = new Date('2026-11-01T12:00:00.000Z')

describe('isRecentLogin', () => {
  test('accepts a session issued just now', () => {
    expect(isRecentLogin(NOW, NOW)).toBe(true)
  })

  test('accepts a session issued within the window', () => {
    const createdAt = new Date(NOW.getTime() - RECENT_LOGIN_MAX_AGE_MS)
    expect(isRecentLogin(createdAt, NOW)).toBe(true)
  })

  test('rejects a session older than the window', () => {
    const createdAt = new Date(NOW.getTime() - RECENT_LOGIN_MAX_AGE_MS - 1)
    expect(isRecentLogin(createdAt, NOW)).toBe(false)
  })

  // 欠落が「いつでも通る」側に倒れてはいけない
  test('rejects when the issue time is unknown', () => {
    expect(isRecentLogin(undefined, NOW)).toBe(false)
  })
})
