import { describe, expect, test } from 'vitest'
import {
  loadNotePagerPref,
  NOTE_PAGER_DEFAULT,
  NOTE_PAGER_STORAGE_KEY,
  parseNotePagerPref,
  saveNotePagerPref,
} from './notePagerPref'

// 読み書きだけの偽 Storage (localStorage の全機能は要らない)
const fakeStorage = (initial: Record<string, string> = {}) => {
  const values = { ...initial }
  return {
    values,
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
  }
}

describe('parseNotePagerPref', () => {
  test('既定はページ送りあり (これまでの見た目)', () => {
    expect(NOTE_PAGER_DEFAULT).toBe(true)
    expect(parseNotePagerPref(null)).toBe(true)
  })

  test("'0' は通し表示", () => {
    expect(parseNotePagerPref('0')).toBe(false)
  })

  test("'1' はページ送り", () => {
    expect(parseNotePagerPref('1')).toBe(true)
  })

  // localStorage は外部入力として扱う (誰かが手で書き換えられる)
  test('知らない値は既定に倒す', () => {
    expect(parseNotePagerPref('yes')).toBe(true)
    expect(parseNotePagerPref('')).toBe(true)
  })
})

describe('loadNotePagerPref', () => {
  test('保存された値を読む', () => {
    const storage = fakeStorage({ [NOTE_PAGER_STORAGE_KEY]: '0' })
    expect(loadNotePagerPref(storage)).toBe(false)
  })

  // プライベートモード等で読めない環境でも本文は従来どおり読める
  test('読めない環境では既定に倒す', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {},
    }
    expect(loadNotePagerPref(storage)).toBe(NOTE_PAGER_DEFAULT)
  })
})

describe('saveNotePagerPref', () => {
  test('通し表示を覚える', () => {
    const storage = fakeStorage()
    saveNotePagerPref(storage, false)
    expect(storage.values[NOTE_PAGER_STORAGE_KEY]).toBe('0')
    saveNotePagerPref(storage, true)
    expect(storage.values[NOTE_PAGER_STORAGE_KEY]).toBe('1')
  })

  test('書けなくても投げない (その場の切り替えは効いている)', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => saveNotePagerPref(storage, false)).not.toThrow()
  })
})
