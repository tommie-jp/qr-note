import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  browserStorage,
  defineBooleanPref,
  definePref,
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from './storagePref'

// 読み書きの記録だけ取る最小の Storage (livePreviewPref.test.ts と同じ流儀)
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
    removeItem: (key: string) => {
      items.delete(key)
    },
    items,
  }
}

// プライベートモード等。触るとすべて投げる
function throwingStorage() {
  const boom = () => {
    throw new Error('SecurityError')
  }
  return { getItem: boom, setItem: boom, removeItem: boom }
}

describe('readStorageItem / writeStorageItem / removeStorageItem', () => {
  test('読み書きと削除が往復する', () => {
    // Arrange
    const storage = fakeStorage()

    // Act
    writeStorageItem(storage, 'k', 'v')
    const written = readStorageItem(storage, 'k')
    removeStorageItem(storage, 'k')

    // Assert
    expect(written).toBe('v')
    expect(readStorageItem(storage, 'k')).toBeNull()
  })

  test('Storage が無ければ読むと null、書く・消すは何もしない', () => {
    expect(readStorageItem(null, 'k')).toBeNull()
    expect(readStorageItem(undefined, 'k')).toBeNull()
    expect(() => writeStorageItem(null, 'k', 'v')).not.toThrow()
    expect(() => removeStorageItem(undefined, 'k')).not.toThrow()
  })

  test('投げる Storage でも例外を外へ出さない', () => {
    // Arrange
    const storage = throwingStorage()

    // Act / Assert
    expect(readStorageItem(storage, 'k')).toBeNull()
    expect(() => writeStorageItem(storage, 'k', 'v')).not.toThrow()
    expect(() => removeStorageItem(storage, 'k')).not.toThrow()
  })
})

describe('definePref', () => {
  const pref = definePref<{ n: number }>({
    key: 'json-pref',
    parse: (raw) => {
      const parsed: unknown = JSON.parse(raw)
      return { n: (parsed as { n: number }).n }
    },
    serialize: (value) => JSON.stringify(value),
    fallback: { n: 0 },
  })

  test('書いた値をそのまま読み戻せる', () => {
    // Arrange
    const storage = fakeStorage()

    // Act
    pref.save(storage, { n: 3 })

    // Assert
    expect(storage.items.get('json-pref')).toBe('{"n":3}')
    expect(pref.load(storage)).toEqual({ n: 3 })
  })

  test('未保存は fallback', () => {
    expect(pref.load(fakeStorage())).toEqual({ n: 0 })
    expect(pref.parse(null)).toEqual({ n: 0 })
  })

  test('parse が投げる壊れた値は fallback (外部入力として扱う)', () => {
    // Arrange
    const storage = fakeStorage({ 'json-pref': '{' })

    // Act / Assert
    expect(pref.load(storage)).toEqual({ n: 0 })
  })

  test('読めない・書けない環境でも投げずに fallback で動く', () => {
    // Arrange
    const storage = throwingStorage()

    // Act / Assert
    expect(pref.load(storage)).toEqual({ n: 0 })
    expect(pref.load(null)).toEqual({ n: 0 })
    expect(() => pref.save(storage, { n: 1 })).not.toThrow()
    expect(() => pref.remove(storage)).not.toThrow()
  })

  test('remove で未保存に戻る', () => {
    // Arrange
    const storage = fakeStorage({ 'json-pref': '{"n":5}' })

    // Act
    pref.remove(storage)

    // Assert
    expect(storage.items.has('json-pref')).toBe(false)
    expect(pref.load(storage)).toEqual({ n: 0 })
  })
})

describe('defineBooleanPref', () => {
  test("'1' / '0' で覚え、読み戻せる", () => {
    // Arrange
    const pref = defineBooleanPref('flag', true)
    const storage = fakeStorage()

    // Act
    pref.save(storage, false)

    // Assert
    expect(storage.items.get('flag')).toBe('0')
    expect(pref.load(storage)).toBe(false)
    pref.save(storage, true)
    expect(storage.items.get('flag')).toBe('1')
    expect(pref.load(storage)).toBe(true)
  })

  test('知らない値と未保存は fallback に倒す', () => {
    const on = defineBooleanPref('flag', true)
    const off = defineBooleanPref('flag', false)
    expect(on.parse('yes')).toBe(true)
    expect(on.parse('')).toBe(true)
    expect(on.parse(null)).toBe(true)
    expect(off.parse('yes')).toBe(false)
    expect(off.parse('0')).toBe(false)
    expect(off.parse('1')).toBe(true)
  })
})

describe('browserStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('window の Storage を返す', () => {
    // Arrange
    const local = fakeStorage()
    const session = fakeStorage()
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session })

    // Act / Assert
    expect(browserStorage()).toBe(local)
    expect(browserStorage('sessionStorage')).toBe(session)
  })

  test('window が無ければ null (サーバ側の描画)', () => {
    vi.stubGlobal('window', undefined)
    expect(browserStorage()).toBeNull()
  })

  // Firefox の dom.storage.enabled=false は例外を出さずに undefined になる
  test('Storage が undefined なら null', () => {
    vi.stubGlobal('window', { localStorage: undefined })
    expect(browserStorage()).toBeNull()
  })

  // Cookie を全面禁止した Chrome などは、window.localStorage を触るだけで投げる
  test('Storage を触るだけで投げても null', () => {
    // Arrange
    const win = {}
    Object.defineProperty(win, 'localStorage', {
      get: () => {
        throw new Error('SecurityError')
      },
    })
    vi.stubGlobal('window', win)

    // Act / Assert
    expect(browserStorage()).toBeNull()
  })
})
