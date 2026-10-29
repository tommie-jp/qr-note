import { afterEach, describe, expect, test, vi } from 'vitest'
import { navigate, refreshServerView, registerRouter } from './navigation'

// 端末側の action が画面を動かす窓口 (docs/123 §2-1)

afterEach(() => {
  registerRouter(null)
  vi.unstubAllGlobals()
})

describe('navigation', () => {
  test('登録された router で push / replace / refresh する', () => {
    // Arrange
    const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
    registerRouter(router)

    // Act
    navigate('/item/1')
    navigate('/?q=a', { replace: true })
    refreshServerView()

    // Assert
    expect(router.push).toHaveBeenCalledWith('/item/1')
    expect(router.replace).toHaveBeenCalledWith('/?q=a', { scroll: false })
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  test('登録前は素の画面遷移に倒し、描き直しは何もしない', () => {
    // Arrange
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })

    // Act
    navigate('/trash')
    refreshServerView()

    // Assert
    expect(assign).toHaveBeenCalledWith('/trash')
  })
})
