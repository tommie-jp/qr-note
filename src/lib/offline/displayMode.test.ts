import { afterEach, expect, test, vi } from 'vitest'
import { isStandaloneDisplay, subscribeDisplayMode } from './displayMode'

// テスト環境は node なので window が無い。必要なぶんだけ生やして戻す
function stubWindow(options: {
  matches?: (query: string) => boolean
  standalone?: boolean
  noMatchMedia?: boolean
  listeners?: { added: string[]; removed: string[] }
}): void {
  vi.stubGlobal('window', {
    matchMedia: options.noMatchMedia
      ? undefined
      : (query: string) => ({
          matches: options.matches?.(query) ?? false,
          addEventListener: () => options.listeners?.added.push(query),
          removeEventListener: () => options.listeners?.removed.push(query),
        }),
    navigator: { standalone: options.standalone },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('SSR (window が無い) では false', () => {
  // window を生やさないまま呼ぶ
  expect(isStandaloneDisplay()).toBe(false)
})

test('通常のブラウザタブでは false', () => {
  stubWindow({ matches: () => false })
  expect(isStandaloneDisplay()).toBe(false)
})

test.each([
  '(display-mode: standalone)',
  '(display-mode: minimal-ui)',
  '(display-mode: fullscreen)',
])('ブラウザ UI の無い表示モード %s では true', (mode) => {
  stubWindow({ matches: (query) => query === mode })
  expect(isStandaloneDisplay()).toBe(true)
})

// 古い iOS は display-mode が効かないことがあるため、独自フラグも見る
test('iOS の navigator.standalone が true なら true', () => {
  stubWindow({ matches: () => false, standalone: true })
  expect(isStandaloneDisplay()).toBe(true)
})

test('matchMedia が無い環境でも throw しない', () => {
  stubWindow({ noMatchMedia: true })
  expect(() => isStandaloneDisplay()).not.toThrow()
  expect(isStandaloneDisplay()).toBe(false)
})

// 表示モードは起動後にも変わりうる (ブラウザで開いたままホーム画面に追加など)。
// useSyncExternalStore が購読・解除できること
test('表示モードの変化を購読し、解除できる', () => {
  const listeners = { added: [] as string[], removed: [] as string[] }
  stubWindow({ matches: () => false, listeners })

  const unsubscribe = subscribeDisplayMode(() => {})
  expect(listeners.added).toHaveLength(3) // standalone / minimal-ui / fullscreen
  expect(listeners.removed).toHaveLength(0)

  unsubscribe()
  expect(listeners.removed).toEqual(listeners.added)
})

test('購読できない環境でも throw せず解除関数を返す', () => {
  stubWindow({ noMatchMedia: true })
  const unsubscribe = subscribeDisplayMode(() => {})
  expect(() => unsubscribe()).not.toThrow()
})
