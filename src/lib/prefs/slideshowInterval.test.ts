import { expect, test } from 'vitest'
import {
  DEFAULT_SLIDESHOW_INTERVAL,
  SLIDESHOW_INTERVAL_STORAGE_KEY,
  loadSlideshowInterval,
  nextSlideshowInterval,
  parseSlideshowInterval,
  saveSlideshowInterval,
} from './slideshowInterval'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    map,
  }
}

test('保存されていなければ既定の 5 秒にする', () => {
  expect(DEFAULT_SLIDESHOW_INTERVAL).toBe(5)
  expect(parseSlideshowInterval(null)).toBe(5)
})

test('保存された段をそのまま読む', () => {
  expect(parseSlideshowInterval('3')).toBe(3)
  expect(parseSlideshowInterval('10')).toBe(10)
})

// localStorage は誰でも書ける。0 秒や巨大な値で暴走させない
test('段に無い値は既定に倒す', () => {
  expect(parseSlideshowInterval('')).toBe(5)
  expect(parseSlideshowInterval('0')).toBe(5)
  expect(parseSlideshowInterval('4')).toBe(5)
  expect(parseSlideshowInterval('abc')).toBe(5)
})

test('保存して読み直すと同じ段になる', () => {
  const storage = memoryStorage()
  saveSlideshowInterval(storage, 10)
  expect(storage.map.get(SLIDESHOW_INTERVAL_STORAGE_KEY)).toBe('10')
  expect(loadSlideshowInterval(storage)).toBe(10)
})

test('Storage が投げても既定で動き、書き込みは握る', () => {
  const broken = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
  expect(loadSlideshowInterval(broken)).toBe(5)
  expect(() => saveSlideshowInterval(broken, 3)).not.toThrow()
})

test('釦を押すたびに 3 → 5 → 10 → 3 と回る', () => {
  expect(nextSlideshowInterval(3)).toBe(5)
  expect(nextSlideshowInterval(5)).toBe(10)
  expect(nextSlideshowInterval(10)).toBe(3)
})
