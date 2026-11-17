import { describe, expect, test } from 'vitest'
import {
  DEFAULT_LIST_PLACEHOLDERS,
  LIST_PLACEHOLDERS_STORAGE_KEY,
  listPlaceholdersLabel,
  loadListPlaceholders,
  saveListPlaceholders,
  stepListPlaceholders,
} from './listPlaceholders'

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

// 「一覧の枠」の件数 (docs/129 §1)
describe('listPlaceholders', () => {
  test('未保存・知らない値は既定 (100 件)', () => {
    expect(loadListPlaceholders(memoryStorage())).toBe(DEFAULT_LIST_PLACEHOLDERS)
    expect(loadListPlaceholders(memoryStorage({ [LIST_PLACEHOLDERS_STORAGE_KEY]: '37' }))).toBe(100)
    expect(loadListPlaceholders(null)).toBe(100)
  })

  test('保存した段を読み戻す', () => {
    // Arrange
    const storage = memoryStorage()

    // Act
    saveListPlaceholders(storage, 0)

    // Assert
    expect(loadListPlaceholders(storage)).toBe(0)
  })

  test('＋ / − は 1 段ずつで、端では動かない', () => {
    expect(stepListPlaceholders(100, 1)).toBe(200)
    expect(stepListPlaceholders(100, -1)).toBe(50)
    expect(stepListPlaceholders(0, -1)).toBe(0)
    expect(stepListPlaceholders(500, 1)).toBe(500)
  })

  test('0 は「なし」', () => {
    expect(listPlaceholdersLabel(0)).toBe('なし')
    expect(listPlaceholdersLabel(200)).toBe('200 件')
  })
})
