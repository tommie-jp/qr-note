import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  clearPasskeyHint,
  hasPasskeyHint,
  isAutoLoginSuppressed,
  markPasskeyUsedHere,
  suppressAutoLogin,
} from './passkeyHint'

// localStorage / sessionStorage は node 環境には無いので自前で置く。
// 「投げる storage」も再現したいので、実物ではなくこの偽物を使う
function createStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error('SecurityError: storage is disabled')
  }
  return {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
    key: boom,
    get length(): number {
      return boom()
    },
  } as unknown as Storage
}

function stubStorages(local: Storage, session: Storage): void {
  vi.stubGlobal('window', { localStorage: local, sessionStorage: session })
  vi.stubGlobal('localStorage', local)
  vi.stubGlobal('sessionStorage', session)
}

beforeEach(() => {
  stubStorages(createStorage(), createStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('passkey hint', () => {
  test('is absent before a passkey has ever been used here', () => {
    expect(hasPasskeyHint()).toBe(false)
  })

  test('is present once a passkey succeeded on this browser', () => {
    markPasskeyUsedHere()

    expect(hasPasskeyHint()).toBe(true)
  })

  test('can be marked twice without changing the answer', () => {
    markPasskeyUsedHere()
    markPasskeyUsedHere()

    expect(hasPasskeyHint()).toBe(true)
  })

  test('is gone after it is cleared (every passkey was deleted)', () => {
    markPasskeyUsedHere()

    clearPasskeyHint()

    expect(hasPasskeyHint()).toBe(false)
  })

  test('clearing when nothing was stored is harmless', () => {
    expect(() => clearPasskeyHint()).not.toThrow()
    expect(hasPasskeyHint()).toBe(false)
  })

  test('stores no personal data — only a flag', () => {
    markPasskeyUsedHere()

    // 利用者名などを置かない。ヒントは「出す/出さない」を決めるだけのもの
    const stored = [...Array(localStorage.length).keys()].map((i) => {
      const key = localStorage.key(i) as string
      return localStorage.getItem(key) as string
    })
    expect(stored).toEqual(['1'])
  })
})

describe('auto-login suppression (per tab)', () => {
  test('is not suppressed by default', () => {
    expect(isAutoLoginSuppressed()).toBe(false)
  })

  test('is suppressed after the user cancelled the prompt', () => {
    suppressAutoLogin()

    expect(isAutoLoginSuppressed()).toBe(true)
  })

  test('lives in sessionStorage so a new tab starts fresh', () => {
    suppressAutoLogin()
    // 別タブ = 新しい sessionStorage。localStorage のヒントは持ち越す
    stubStorages(localStorage, createStorage())

    expect(isAutoLoginSuppressed()).toBe(false)
  })

  test('does not disturb the passkey hint', () => {
    markPasskeyUsedHere()

    suppressAutoLogin()

    expect(hasPasskeyHint()).toBe(true)
  })
})

describe('when storage is unavailable', () => {
  // プライベートモードや storage を無効にした環境。**自動が出なくなるだけ**で、
  // 手動のログインボタンは無傷でなければならない
  beforeEach(() => {
    stubStorages(throwingStorage(), throwingStorage())
  })

  test('reports no hint instead of throwing', () => {
    expect(hasPasskeyHint()).toBe(false)
  })

  test('reports not suppressed instead of throwing', () => {
    expect(isAutoLoginSuppressed()).toBe(false)
  })

  test('marking does not throw', () => {
    expect(() => markPasskeyUsedHere()).not.toThrow()
  })

  test('clearing does not throw', () => {
    expect(() => clearPasskeyHint()).not.toThrow()
  })

  test('suppressing does not throw', () => {
    expect(() => suppressAutoLogin()).not.toThrow()
  })
})

describe('when there is no window at all (server side)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', undefined)
  })

  test('reports no hint', () => {
    expect(hasPasskeyHint()).toBe(false)
  })

  test('reports not suppressed', () => {
    expect(isAutoLoginSuppressed()).toBe(false)
  })

  test('writing is a no-op rather than a crash', () => {
    expect(() => markPasskeyUsedHere()).not.toThrow()
    expect(() => suppressAutoLogin()).not.toThrow()
    expect(() => clearPasskeyHint()).not.toThrow()
  })
})
