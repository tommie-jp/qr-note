import { describe, expect, test } from 'vitest'
import {
  LIVE_PREVIEW_DEFAULT,
  LIVE_PREVIEW_STORAGE_KEY,
  loadLivePreviewPref,
  parseLivePreviewPref,
  saveLivePreviewPref,
  type LivePreviewStorage,
} from './livePreviewPref'

// 読み書きの記録だけ取る最小の Storage (memoDraft.test.ts と同じ流儀)
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
    items,
  }
}

describe('parseLivePreviewPref', () => {
  test('保存された ON を読む', () => {
    expect(parseLivePreviewPref('1')).toBe(true)
  })

  test('保存された OFF を読む', () => {
    expect(parseLivePreviewPref('0')).toBe(false)
  })

  test('未保存 (null) は既定に倒す', () => {
    expect(parseLivePreviewPref(null)).toBe(LIVE_PREVIEW_DEFAULT)
  })

  test('知らない値は既定に倒す', () => {
    // localStorage は外部入力。手で書き換えられていても既定で動く
    expect(parseLivePreviewPref('yes')).toBe(LIVE_PREVIEW_DEFAULT)
    expect(parseLivePreviewPref('')).toBe(LIVE_PREVIEW_DEFAULT)
  })
})

describe('loadLivePreviewPref / saveLivePreviewPref', () => {
  test('書いた値をそのまま読み戻せる', () => {
    // Arrange
    const storage = fakeStorage()

    // Act
    saveLivePreviewPref(storage, true)

    // Assert
    expect(storage.items.get(LIVE_PREVIEW_STORAGE_KEY)).toBe('1')
    expect(loadLivePreviewPref(storage)).toBe(true)
  })

  test('OFF も覚える (既定が ON になっても OFF を保てる)', () => {
    const storage = fakeStorage()
    saveLivePreviewPref(storage, false)
    expect(loadLivePreviewPref(storage)).toBe(false)
  })

  test('読めない環境では既定に落ちる (例外を投げない)', () => {
    // Arrange: プライベートモード等で getItem 自体が例外になる環境
    const storage: LivePreviewStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {},
    }

    // Act / Assert
    expect(loadLivePreviewPref(storage)).toBe(LIVE_PREVIEW_DEFAULT)
  })

  test('書けない環境でも例外を投げない (その場の切り替えは効く)', () => {
    const storage: LivePreviewStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }

    expect(() => saveLivePreviewPref(storage, true)).not.toThrow()
  })
})
