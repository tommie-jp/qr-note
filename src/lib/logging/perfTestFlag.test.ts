import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { clearPerfTestPending, markPerfTestPending, takePerfTestPending } from './perfTestFlag'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  }
}

beforeEach(() => vi.stubGlobal('sessionStorage', memoryStorage()))
afterEach(() => vi.unstubAllGlobals())

test('印を付けると 1 度だけ読める', () => {
  markPerfTestPending()

  expect(takePerfTestPending()).toBe(true)
  expect(takePerfTestPending()).toBe(false)
})

test('消した印は読めない', () => {
  markPerfTestPending()
  clearPerfTestPending()

  expect(takePerfTestPending()).toBe(false)
})

test('保存を塞いだブラウザでも例外を投げない', () => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('SecurityError')
    },
    removeItem: () => {
      throw new Error('SecurityError')
    },
  })

  expect(() => markPerfTestPending()).not.toThrow()
  expect(takePerfTestPending()).toBe(false)
  expect(() => clearPerfTestPending()).not.toThrow()
})
