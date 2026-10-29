import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  clearPerfTestPending,
  parsePerfTestOptions,
  clearPerfTestRunning,
  markPerfTestPending,
  markPerfTestRunning,
  takePerfTestInterrupted,
  takePerfTestPending,
} from './perfTestFlag'

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

  expect(takePerfTestPending()).toEqual({})
  expect(takePerfTestPending()).toBeNull()
})

test('消した印は読めない', () => {
  markPerfTestPending()
  clearPerfTestPending()

  expect(takePerfTestPending()).toBeNull()
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
  expect(takePerfTestPending()).toBeNull()
  expect(() => clearPerfTestPending()).not.toThrow()
})

test('流している最中の印が残っていれば、途中で切れたと 1 度だけ分かる', () => {
  markPerfTestRunning()

  expect(takePerfTestInterrupted()).toBe(true)
  expect(takePerfTestInterrupted()).toBe(false)
})

test('最後まで流して消した印は、切れたことにならない', () => {
  markPerfTestRunning()
  clearPerfTestRunning()

  expect(takePerfTestInterrupted()).toBe(false)
})

test('流し方 (回線・戻り先) を添えた印は中身ごと読める', () => {
  markPerfTestPending({ line: 'Wi-Fi', returnTo: '/settings/benchmark' })

  expect(takePerfTestPending()).toEqual({ line: 'Wi-Fi', returnTo: '/settings/benchmark' })
})

test('旧形式の印 (1) は中身なしとして読む', () => {
  sessionStorage.setItem('qr:perfTest', '1')

  expect(takePerfTestPending()).toEqual({})
})

test('許していない戻り先は捨てる', () => {
  expect(parsePerfTestOptions(JSON.stringify({ returnTo: 'https://evil.example/' }))).toEqual({})
  expect(parsePerfTestOptions(JSON.stringify({ returnTo: '/settings/benchmark', line: '' }))).toEqual({
    returnTo: '/settings/benchmark',
  })
})
