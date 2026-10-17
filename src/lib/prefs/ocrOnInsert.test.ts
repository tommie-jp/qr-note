import { describe, expect, test } from 'vitest'
import {
  loadOcrOnInsertPref,
  OCR_ON_INSERT_DEFAULT,
  OCR_ON_INSERT_STORAGE_KEY,
  parseOcrOnInsertPref,
  saveOcrOnInsertPref,
} from './ocrOnInsert'

// 読み書きの記録だけ取る最小の Storage (prefs/livePreview.test.ts と同じ流儀)
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

describe('parseOcrOnInsertPref', () => {
  test('保存された ON / OFF を読む', () => {
    expect(parseOcrOnInsertPref('1')).toBe(true)
    expect(parseOcrOnInsertPref('0')).toBe(false)
  })

  test('未保存・知らない値は既定 (ON) に倒す', () => {
    expect(OCR_ON_INSERT_DEFAULT).toBe(true)
    expect(parseOcrOnInsertPref(null)).toBe(true)
    expect(parseOcrOnInsertPref('off')).toBe(true)
  })
})

describe('loadOcrOnInsertPref / saveOcrOnInsertPref', () => {
  test('OFF を保存すると次に読んだとき OFF', () => {
    // Arrange
    const storage = fakeStorage()

    // Act
    saveOcrOnInsertPref(storage, false)

    // Assert
    expect(storage.items.get(OCR_ON_INSERT_STORAGE_KEY)).toBe('0')
    expect(loadOcrOnInsertPref(storage)).toBe(false)
  })

  test('Storage が無い環境では既定で読め、保存しても投げない', () => {
    expect(loadOcrOnInsertPref(null)).toBe(true)
    expect(() => saveOcrOnInsertPref(null, false)).not.toThrow()
  })
})
