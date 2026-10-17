import { describe, expect, test } from 'vitest'
import {
  IMAGE_FIT_DEFAULT,
  IMAGE_FIT_STORAGE_KEY,
  loadImageFitPref,
  parseImageFitPref,
  saveImageFitPref,
} from './imageFit'

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

describe('parseImageFitPref', () => {
  test('既定は全体を表示 (縦長の画像も 1 画面に収める)', () => {
    expect(IMAGE_FIT_DEFAULT).toBe('page')
    expect(parseImageFitPref(null)).toBe('page')
  })

  test("'width' は幅に合わせる", () => {
    expect(parseImageFitPref('width')).toBe('width')
  })

  test("'page' は全体を表示", () => {
    expect(parseImageFitPref('page')).toBe('page')
  })

  // localStorage は外部入力として扱う (誰かが手で書き換えられる)
  test('知らない値は既定に倒す', () => {
    expect(parseImageFitPref('fit')).toBe('page')
    expect(parseImageFitPref('')).toBe('page')
  })
})

describe('loadImageFitPref / saveImageFitPref', () => {
  test('保存した値を読み戻せる', () => {
    const storage = fakeStorage()
    saveImageFitPref(storage, 'width')
    expect(storage.values[IMAGE_FIT_STORAGE_KEY]).toBe('width')
    expect(loadImageFitPref(storage)).toBe('width')
  })

  test('Storage が無ければ既定', () => {
    expect(loadImageFitPref(null)).toBe('page')
  })

  test('読むと投げる Storage でも既定で動く', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(loadImageFitPref(throwing)).toBe('page')
    expect(() => saveImageFitPref(throwing, 'width')).not.toThrow()
  })
})
