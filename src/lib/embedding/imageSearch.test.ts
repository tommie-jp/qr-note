import { expect, test } from 'vitest'
import { isConfident, rankItems, type ImageVectorEntry } from './imageSearch'
import { normalize } from './imageVector'

// テスト用: 生ベクトルを正規化して索引 1 件を作る。
function entry(
  itemNo: string,
  imageName: string,
  vec: number[],
  title = itemNo,
): ImageVectorEntry {
  return { itemNo, title, imageName, embedding: normalize(new Float32Array(vec)) }
}

const QUERY = normalize(new Float32Array([1, 0, 0]))

test('クエリに近い順に返す', () => {
  const entries = [
    entry('a', 'a.jpg', [0, 1, 0]), // 直交 → 0
    entry('b', 'b.jpg', [1, 0, 0]), // 一致 → 1
    entry('c', 'c.jpg', [1, 1, 0]), // 45 度 → 0.707
  ]

  const ranked = rankItems(QUERY, entries)

  expect(ranked.map((m) => m.itemNo)).toEqual(['b', 'c', 'a'])
  expect(ranked[0].score).toBeCloseTo(1)
})

test('ノートのスコアは所属画像の最大類似度で集約する', () => {
  // 同じ itemNo に 2 枚。1 枚は直交、もう 1 枚は一致 → ノートは一致側で採る
  const entries = [
    entry('x', 'far.jpg', [0, 1, 0]),
    entry('x', 'near.jpg', [1, 0, 0]),
  ]

  const ranked = rankItems(QUERY, entries)

  expect(ranked).toHaveLength(1)
  expect(ranked[0].score).toBeCloseTo(1)
  // 似ていた方の画像をサムネ用に返す
  expect(ranked[0].imageName).toBe('near.jpg')
})

test('limit で件数を絞る', () => {
  const entries = [
    entry('a', 'a.jpg', [1, 0, 0]),
    entry('b', 'b.jpg', [0.9, 0.1, 0]),
    entry('c', 'c.jpg', [0.8, 0.2, 0]),
  ]

  expect(rankItems(QUERY, entries, { limit: 2 })).toHaveLength(2)
})

test('minScore 未満は捨てる', () => {
  const entries = [
    entry('a', 'a.jpg', [1, 0, 0]), // 1
    entry('b', 'b.jpg', [0, 1, 0]), // 0
  ]

  const ranked = rankItems(QUERY, entries, { minScore: 0.5 })

  expect(ranked.map((m) => m.itemNo)).toEqual(['a'])
})

test('同点は itemNo 昇順で安定する', () => {
  const entries = [
    entry('b', 'b.jpg', [1, 0, 0]),
    entry('a', 'a.jpg', [1, 0, 0]),
  ]

  expect(rankItems(QUERY, entries).map((m) => m.itemNo)).toEqual(['a', 'b'])
})

test('索引が空なら空配列', () => {
  expect(rankItems(QUERY, [])).toEqual([])
})

test('isConfident: 1 位と 2 位の差が閾値以上なら確信あり', () => {
  const matches = [
    { itemNo: 'a', title: 'a', imageName: 'a.jpg', score: 0.9 },
    { itemNo: 'b', title: 'b', imageName: 'b.jpg', score: 0.6 },
  ]
  expect(isConfident(matches, 0.2)).toBe(true)
  expect(isConfident(matches, 0.4)).toBe(false)
})

test('isConfident: 候補 1 件は確信あり、0 件は無し', () => {
  const one = [{ itemNo: 'a', title: 'a', imageName: 'a.jpg', score: 0.9 }]
  expect(isConfident(one, 0.2)).toBe(true)
  expect(isConfident([], 0.2)).toBe(false)
})
