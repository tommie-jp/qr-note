import { expect, test } from 'vitest'
import {
  DEFAULT_VIEW_MODE,
  parseViewMode,
  VIEW_MODES,
} from './viewMode'

test('card を受け付ける', () => {
  expect(parseViewMode('card')).toBe('card')
})

test('compact を受け付ける', () => {
  expect(parseViewMode('compact')).toBe('compact')
})

test('image を受け付ける', () => {
  expect(parseViewMode('image')).toBe('image')
})

test('medium (中) を受け付ける', () => {
  expect(parseViewMode('medium')).toBe('medium')
})

// 並びがそのまま下部バーの循環になる (小 → 中 → 大 → 画像)
test('循環の順は 小 → 中 → 大 → 画像', () => {
  expect(VIEW_MODES).toEqual(['compact', 'medium', 'card', 'image'])
})

test('既定は今までの見た目 (compact)', () => {
  // この機能が入っても、何もしていない人の画面は変わらない
  expect(DEFAULT_VIEW_MODE).toBe('compact')
  expect(parseViewMode(undefined)).toBe('compact')
})

test('知らない値は既定へ畳む', () => {
  // cookie は利用者が自由に書き換えられる外部入力
  expect(parseViewMode('grid')).toBe('compact')
  expect(parseViewMode('')).toBe('compact')
  expect(parseViewMode(null)).toBe('compact')
  expect(parseViewMode(42)).toBe('compact')
  expect(parseViewMode({ toString: () => 'card' })).toBe('compact')
})
