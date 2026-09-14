import { expect, test } from 'vitest'
import { resolveByteRange } from './httpRange'

const SIZE = 100

test('Range ヘッダが無ければ null (全体を返す合図)', () => {
  expect(resolveByteRange(null, SIZE)).toBeNull()
  expect(resolveByteRange(undefined, SIZE)).toBeNull()
  expect(resolveByteRange('', SIZE)).toBeNull()
})

test('start-end を inclusive で解決する', () => {
  expect(resolveByteRange('bytes=0-9', SIZE)).toEqual({ start: 0, end: 9 })
  expect(resolveByteRange('bytes=10-19', SIZE)).toEqual({ start: 10, end: 19 })
})

test('end 省略は最後まで', () => {
  expect(resolveByteRange('bytes=50-', SIZE)).toEqual({ start: 50, end: 99 })
  expect(resolveByteRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 99 })
})

test('end が全長を超えたら全長-1 で頭打ちにする', () => {
  expect(resolveByteRange('bytes=90-999', SIZE)).toEqual({ start: 90, end: 99 })
})

test('末尾 N バイト (bytes=-N)', () => {
  expect(resolveByteRange('bytes=-20', SIZE)).toEqual({ start: 80, end: 99 })
  // 全長より大きい suffix は 0 から
  expect(resolveByteRange('bytes=-999', SIZE)).toEqual({ start: 0, end: 99 })
})

test('前後の空白は無視する', () => {
  expect(resolveByteRange('  bytes=0-9  ', SIZE)).toEqual({ start: 0, end: 9 })
})

test('範囲外 (start が全長以上) は unsatisfiable', () => {
  expect(resolveByteRange('bytes=100-110', SIZE)).toBe('unsatisfiable')
  expect(resolveByteRange('bytes=200-', SIZE)).toBe('unsatisfiable')
  // 空ファイルはどんな start でも満たせない
  expect(resolveByteRange('bytes=0-0', 0)).toBe('unsatisfiable')
})

test('末尾 0 バイト (bytes=-0) は unsatisfiable', () => {
  expect(resolveByteRange('bytes=-0', SIZE)).toBe('unsatisfiable')
})

test('end < start は unsatisfiable', () => {
  expect(resolveByteRange('bytes=50-10', SIZE)).toBe('unsatisfiable')
})

test('解釈できない形は null (全体を返す)', () => {
  // 複数レンジは扱わない
  expect(resolveByteRange('bytes=0-9,20-29', SIZE)).toBeNull()
  // bytes 以外の単位
  expect(resolveByteRange('items=0-9', SIZE)).toBeNull()
  // 両端とも空
  expect(resolveByteRange('bytes=-', SIZE)).toBeNull()
  expect(resolveByteRange('bytes=abc', SIZE)).toBeNull()
})
