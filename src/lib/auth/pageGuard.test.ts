import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// auth/session.ts は cookies() を呼ぶので差し替える。items/resolve.ts は db.ts
// (DATABASE_URL) を引き込むので差し替える。notFound() / redirect() /
// permanentRedirect() は本物 — Next が 404 や転送に読み替える印 (digest) を
// 持った例外を投げる
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  currentUser: vi.fn(),
  resolveItemKey: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  requireUser: mocks.requireUser,
  currentUser: mocks.currentUser,
}))
vi.mock('@/lib/items/resolve', () => ({ resolveItemKey: mocks.resolveItemKey }))

const { guardItemPage, requireAdminPage, requireSettingsPage } = await import('./pageGuard')

const NOT_FOUND = expect.objectContaining({
  digest: expect.stringContaining('404'),
})

// redirect() は 307 (一時)、permanentRedirect() は 308 (永久) の印を持つ
const redirectTo = (url: string, status: 307 | 308) =>
  expect.objectContaining({
    digest: expect.stringMatching(
      new RegExp(`^NEXT_REDIRECT;[a-z]+;${url.replace(/[?]/g, '\\?')};${status};$`),
    ),
  })

const ID = '00000000-0000-7000-8000-000000004951'
const pathOf = (itemId: string) => `/item/${itemId}/history`

beforeEach(() => {
  mocks.requireUser.mockReset()
  mocks.requireUser.mockResolvedValue('tommie')
  mocks.currentUser.mockReset()
  mocks.currentUser.mockResolvedValue('tommie')
  mocks.resolveItemKey.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test('UUID はそのまま返し、DB もセッションも引かない', async () => {
  // Act
  const itemId = await guardItemPage(ID, pathOf)

  // Assert
  expect(itemId).toBe(ID)
  expect(mocks.resolveItemKey).not.toHaveBeenCalled()
  expect(mocks.currentUser).not.toHaveBeenCalled()
})

test('旧番号が 1 件に決まれば、id の URL へ永久に転送する', async () => {
  // Arrange
  mocks.resolveItemKey.mockResolvedValue({ kind: 'legacy', itemId: ID })

  // Act / Assert
  await expect(guardItemPage('1003', pathOf)).rejects.toThrow(
    redirectTo(`/item/${ID}/history`, 308),
  )
  expect(mocks.resolveItemKey).toHaveBeenCalledWith('1003', { publicOnly: false })
})

test('旧番号が 0 件・複数なら検索へ一時の転送をする', async () => {
  // Arrange
  mocks.resolveItemKey.mockResolvedValue({ kind: 'search', href: '/?q=100x' })

  // Act / Assert
  await expect(guardItemPage('100x', pathOf)).rejects.toThrow(redirectTo('/?q=100x', 307))
})

// 非公開ノートまで引いて付け替えると、id が外から判ってしまう
test('未ログインなら公開ノートだけで旧番号を引く', async () => {
  // Arrange
  mocks.currentUser.mockResolvedValue(null)
  mocks.resolveItemKey.mockResolvedValue({ kind: 'search', href: '/?q=1003' })

  // Act / Assert
  await expect(guardItemPage('1003', pathOf)).rejects.toThrow(redirectTo('/?q=1003', 307))
  expect(mocks.resolveItemKey).toHaveBeenCalledWith('1003', { publicOnly: true })
})

test('形の合わない値は DB を引かずに 404 にする', async () => {
  // Act / Assert
  await expect(guardItemPage('../etc', pathOf)).rejects.toThrow(NOT_FOUND)
  await expect(guardItemPage('', pathOf)).rejects.toThrow(NOT_FOUND)
  // 大文字の UUID は URL を 1 つに保つため受けない。旧番号にしては長すぎる
  await expect(
    guardItemPage('0192F5E8-7A3B-7C4D-8E5F-0123456789AB', pathOf),
  ).rejects.toThrow(NOT_FOUND)
  expect(mocks.resolveItemKey).not.toHaveBeenCalled()
})

test('解決できない結果が返っても 404 に倒す', async () => {
  // Arrange
  mocks.resolveItemKey.mockResolvedValue({ kind: 'invalid' })

  // Act / Assert
  await expect(guardItemPage('1003', pathOf)).rejects.toThrow(NOT_FOUND)
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

test('管理者ページは ADMIN_USER と一致するユーザーを返す', async () => {
  // Arrange
  vi.stubEnv('DEMO_MODE', '')
  vi.stubEnv('ADMIN_USER', 'tommie')

  // Act
  const user = await requireAdminPage()

  // Assert
  expect(user).toBe('tommie')
})

test('管理者ページはログイン中でも管理者でなければ 404 にし、warn を残す', async () => {
  // Arrange
  vi.stubEnv('DEMO_MODE', '')
  vi.stubEnv('ADMIN_USER', 'tommie')
  mocks.requireUser.mockResolvedValue('guest')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  // Act / Assert
  await expect(requireAdminPage()).rejects.toThrow(NOT_FOUND)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('guest'))
  warn.mockRestore()
})

test('管理者ページは ADMIN_USER が未設定なら誰にも見せない', async () => {
  // Arrange
  vi.stubEnv('DEMO_MODE', '')
  vi.stubEnv('ADMIN_USER', undefined)

  // Act / Assert
  await expect(requireAdminPage()).rejects.toThrow(NOT_FOUND)
})

test('管理者ページはデモなら 404 にする (設定系の門番を通す)', async () => {
  // Arrange
  vi.stubEnv('DEMO_MODE', '1')
  vi.stubEnv('ADMIN_USER', 'tommie')

  // Act / Assert
  await expect(requireAdminPage()).rejects.toThrow(NOT_FOUND)
  expect(mocks.requireUser).not.toHaveBeenCalled()
})
