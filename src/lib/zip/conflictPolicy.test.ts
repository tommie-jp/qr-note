import { expect, test } from 'vitest'
import { parseConflictPolicy } from './conflictPolicy'

// 省略は安全側 (見送り) へ倒す。旗の欠落が無防備 (上書き・複製) へ倒れない
test('省略 (null) は skip', () => {
  expect(parseConflictPolicy(null)).toBe('skip')
})

test('3 つの値はそのまま通る', () => {
  expect(parseConflictPolicy('skip')).toBe('skip')
  expect(parseConflictPolicy('overwrite')).toBe('overwrite')
  expect(parseConflictPolicy('renumber')).toBe('renumber')
})

// タイポで renumber のつもりが skip で走ると「取り込めたのに増えていない」に
// 見える。黙って既定へ倒さず、呼ぶ側に断らせる (export の scope と同じ主義)
test('未知の値は null (断る)', () => {
  expect(parseConflictPolicy('renumbeer')).toBeNull()
  expect(parseConflictPolicy('1')).toBeNull()
  expect(parseConflictPolicy('SKIP')).toBeNull()
})

// `?conflict=` は「指定したつもりで値が抜けた」形。省略とは区別して断る
test('空文字は省略ではなく未知の値として断る', () => {
  expect(parseConflictPolicy('')).toBeNull()
})
