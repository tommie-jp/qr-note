import { expect, test } from 'vitest'
import { firstUnusedNo, MIN_ITEM_NO } from './itemNo'

test('下限は 1000 (実運用の番号帯の始まり)', () => {
  expect(MIN_ITEM_NO).toBe(1000)
})

test('使用中が無ければ下限そのもの', () => {
  expect(firstUnusedNo([], 1000)).toBe(1000)
})

test('下限から連番で埋まっていれば次の番号', () => {
  expect(firstUnusedNo([1000, 1001, 1002], 1000)).toBe(1003)
})

test('隙間があればそれを埋める (max+1 にしない)', () => {
  // 欠番を埋めるのがこの関数の目的。max+1 なら 6001 になってしまう
  expect(firstUnusedNo([1000, 1001, 1003, 6000], 1000)).toBe(1002)
})

test('先頭が空いていれば下限を返す', () => {
  expect(firstUnusedNo([1005, 1006], 1000)).toBe(1000)
})

test('下限より小さい使用中の番号は無視する', () => {
  // 実データの 1 / 4 / 5 / 6 / 100 は既存の番号帯の外なので埋めにいかない
  expect(firstUnusedNo([1, 4, 5, 6, 100, 1000], 1000)).toBe(1001)
})

test('item_no_num が重複していても数え違えない', () => {
  // itemNo "1000" と "01000" はどちらも item_no_num=1000 になりうる
  expect(firstUnusedNo([1000, 1000, 1001], 1000)).toBe(1002)
})
