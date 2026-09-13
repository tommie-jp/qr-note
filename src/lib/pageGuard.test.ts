import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// session.ts は cookies() を呼ぶので差し替える。notFound() は本物 —
// Next が 404 に読み替える印 (digest) を持った例外を投げる
const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }))

vi.mock('@/lib/session', () => ({ requireUser: mocks.requireUser }))

const { guardItemPage, requireSettingsPage } = await import('./pageGuard')

const NOT_FOUND = expect.objectContaining({
  digest: expect.stringContaining('404'),
})

beforeEach(() => {
  mocks.requireUser.mockReset()
  mocks.requireUser.mockResolvedValue('tommie')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test('正しい形のノート番号は素通しする', () => {
  // Act / Assert
  expect(() => guardItemPage('4951')).not.toThrow()
  expect(() => guardItemPage('100x')).not.toThrow()
})

test('形の合わないノート番号は 404 にする', () => {
  // Act / Assert
  expect(() => guardItemPage('../etc')).toThrow(NOT_FOUND)
  expect(() => guardItemPage('')).toThrow(NOT_FOUND)
})

test('設定ページはデモでなければログインを確かめてユーザーを返す', async () => {
  // Arrange
  vi.stubEnv('DEMO_MODE', '')

  // Act
  const user = await requireSettingsPage()

  // Assert
  expect(user).toBe('tommie')
  expect(mocks.requireUser).toHaveBeenCalledOnce()
})

test('設定ページはデモならログインを確かめる前に 404 にする', async () => {
  // Arrange
  vi.stubEnv('DEMO_MODE', '1')

  // Act / Assert
  await expect(requireSettingsPage()).rejects.toThrow(NOT_FOUND)
  expect(mocks.requireUser).not.toHaveBeenCalled()
})

test('設定ページは未ログインなら requireUser の例外をそのまま投げる', async () => {
  // Arrange
  vi.stubEnv('DEMO_MODE', '')
  const unauthorized = new Error('ログインが必要です')
  mocks.requireUser.mockRejectedValue(unauthorized)

  // Act / Assert
  await expect(requireSettingsPage()).rejects.toBe(unauthorized)
})
