import { describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_DRAW_COLOR,
  DEFAULT_DRAW_WIDTH,
  DRAW_PREFS_KEY,
  loadDrawPrefs,
  saveDrawPrefs,
} from './drawPrefs'
import type { PrefStorage } from '../prefs/storagePref'

// localStorage の代役。vitest の環境は node なので本物は無い
function fakeStorage(initial: Record<string, string> = {}): PrefStorage {
  const data = { ...initial }
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

describe('loadDrawPrefs', () => {
  test('returns the defaults when nothing has been saved', () => {
    // Arrange
    const storage = fakeStorage()

    // Act
    const prefs = loadDrawPrefs(storage)

    // Assert
    expect(prefs).toEqual({ color: DEFAULT_DRAW_COLOR, width: DEFAULT_DRAW_WIDTH })
  })

  test('returns the defaults when storage is unavailable', () => {
    // Arrange & Act
    const prefs = loadDrawPrefs(null)

    // Assert
    expect(prefs).toEqual({ color: DEFAULT_DRAW_COLOR, width: DEFAULT_DRAW_WIDTH })
  })

  test('restores a saved color and width', () => {
    // Arrange
    const storage = fakeStorage({
      [DRAW_PREFS_KEY]: JSON.stringify({ color: '#00aaff', width: 12 }),
    })

    // Act
    const prefs = loadDrawPrefs(storage)

    // Assert
    expect(prefs).toEqual({ color: '#00aaff', width: 12 })
  })

  test('falls back to the default color when the stored value is not a hex triplet', () => {
    // Arrange
    const storage = fakeStorage({
      [DRAW_PREFS_KEY]: JSON.stringify({ color: 'red', width: 12 }),
    })

    // Act
    const prefs = loadDrawPrefs(storage)

    // Assert
    expect(prefs).toEqual({ color: DEFAULT_DRAW_COLOR, width: 12 })
  })

  test('falls back to the default width when the stored value is not one of the options', () => {
    // Arrange
    const storage = fakeStorage({
      [DRAW_PREFS_KEY]: JSON.stringify({ color: '#00aaff', width: 999 }),
    })

    // Act
    const prefs = loadDrawPrefs(storage)

    // Assert
    expect(prefs).toEqual({ color: '#00aaff', width: DEFAULT_DRAW_WIDTH })
  })

  test('returns the defaults when the stored JSON is broken', () => {
    // Arrange
    const storage = fakeStorage({ [DRAW_PREFS_KEY]: '{' })

    // Act
    const prefs = loadDrawPrefs(storage)

    // Assert
    expect(prefs).toEqual({ color: DEFAULT_DRAW_COLOR, width: DEFAULT_DRAW_WIDTH })
  })

  test('returns the defaults when reading throws (private mode)', () => {
    // Arrange
    const storage: PrefStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => undefined,
    }

    // Act
    const prefs = loadDrawPrefs(storage)

    // Assert
    expect(prefs).toEqual({ color: DEFAULT_DRAW_COLOR, width: DEFAULT_DRAW_WIDTH })
  })
})

describe('saveDrawPrefs', () => {
  test('writes the prefs as JSON under the shared key', () => {
    // Arrange
    const setItem = vi.fn()
    const storage: PrefStorage = { getItem: () => null, setItem }

    // Act
    saveDrawPrefs(storage, { color: '#00aaff', width: 12 })

    // Assert
    expect(setItem).toHaveBeenCalledWith(
      DRAW_PREFS_KEY,
      JSON.stringify({ color: '#00aaff', width: 12 }),
    )
  })

  test('ignores a storage that refuses to write', () => {
    // Arrange
    const storage: PrefStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }

    // Act & Assert — 設定の保存はお絵かきの本筋ではないので落とさない
    expect(() => saveDrawPrefs(storage, { color: '#00aaff', width: 12 })).not.toThrow()
  })
})
