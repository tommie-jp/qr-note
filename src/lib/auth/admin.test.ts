import { afterEach, expect, test, vi } from 'vitest'
import { isAdminUser } from './admin'

afterEach(() => {
  vi.unstubAllEnvs()
})

test('ADMIN_USER と完全一致するユーザーだけが管理者', () => {
  // Arrange
  vi.stubEnv('ADMIN_USER', 'tommie')

  // Act & Assert
  expect(isAdminUser('tommie')).toBe(true)
  expect(isAdminUser('guest')).toBe(false)
  expect(isAdminUser('Tommie')).toBe(false)
  expect(isAdminUser('tommie ')).toBe(false)
})

test('未ログイン (null) は管理者ではない', () => {
  // Arrange
  vi.stubEnv('ADMIN_USER', 'tommie')

  // Act & Assert
  expect(isAdminUser(null)).toBe(false)
})

test('ADMIN_USER が未設定なら誰も管理者ではない (欠落は安全側へ倒す)', () => {
  // Arrange
  vi.stubEnv('ADMIN_USER', undefined)

  // Act & Assert
  expect(isAdminUser('tommie')).toBe(false)
})

test('ADMIN_USER が空文字 (.env に `ADMIN_USER=` と書いた形) でも誰も管理者ではない', () => {
  // Arrange
  vi.stubEnv('ADMIN_USER', '')

  // Act & Assert
  expect(isAdminUser('')).toBe(false)
  expect(isAdminUser('tommie')).toBe(false)
})
