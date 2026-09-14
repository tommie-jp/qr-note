import { expect, test } from 'vitest'
import {
  cosineSimilarity,
  deserializeEmbedding,
  dot,
  normalize,
  serializeEmbedding,
} from './imageVector'

test('serialize → deserialize でベクトルが往復する', () => {
  const vec = new Float32Array([0.5, -1.25, 3.0, 0.0])

  const bytes = serializeEmbedding(vec)
  const back = deserializeEmbedding(bytes)

  expect(back).not.toBeNull()
  expect(Array.from(back!)).toEqual([0.5, -1.25, 3.0, 0.0])
})

test('serialize は元 buffer を共有しない (後から書き換えても壊れない)', () => {
  const vec = new Float32Array([1, 2, 3])

  const bytes = serializeEmbedding(vec)
  vec[0] = 99 // 保存後に元を触る

  const back = deserializeEmbedding(bytes)
  expect(back![0]).toBe(1)
})

test('4 バイト境界でない Uint8Array からも復元できる', () => {
  // Prisma の Bytes は byteOffset が 4 の倍数とは限らない。
  const vec = new Float32Array([7, 8, 9])
  const serialized = serializeEmbedding(vec)
  // 先頭に 1 バイト足したバッファの部分ビューを作り、境界をずらす
  const shifted = new Uint8Array(serialized.byteLength + 1)
  shifted.set(serialized, 1)
  const misaligned = shifted.subarray(1)

  const back = deserializeEmbedding(misaligned)

  expect(Array.from(back!)).toEqual([7, 8, 9])
})

test('長さが 4 の倍数でないバイト列は null', () => {
  expect(deserializeEmbedding(new Uint8Array([1, 2, 3]))).toBeNull()
})

test('空のバイト列は null', () => {
  expect(deserializeEmbedding(new Uint8Array([]))).toBeNull()
})

test('normalize は L2 ノルムを 1 にする', () => {
  const out = normalize(new Float32Array([3, 4])) // ノルム 5

  expect(out[0]).toBeCloseTo(0.6)
  expect(out[1]).toBeCloseTo(0.8)
})

test('normalize は元を変更しない (immutable)', () => {
  const vec = new Float32Array([3, 4])
  normalize(vec)
  expect(Array.from(vec)).toEqual([3, 4])
})

test('normalize は 0 ベクトルを 0 のまま返す (0 除算しない)', () => {
  const out = normalize(new Float32Array([0, 0, 0]))
  expect(Array.from(out)).toEqual([0, 0, 0])
})

test('正規化済みベクトルの dot は cosine に一致する', () => {
  const a = normalize(new Float32Array([1, 0, 0]))
  const b = normalize(new Float32Array([1, 1, 0]))

  expect(dot(a, b)).toBeCloseTo(Math.SQRT1_2) // 45 度 = 1/√2
})

test('同一ベクトルの cosine は 1', () => {
  const a = new Float32Array([1, 2, 3])
  expect(cosineSimilarity(a, a)).toBeCloseTo(1)
})

test('直交ベクトルの cosine は 0', () => {
  expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0)
})

test('0 ベクトルとの cosine は 0 (0 除算しない)', () => {
  expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0)
})

test('次元が違うベクトルは投げる', () => {
  expect(() => dot(new Float32Array([1, 2]), new Float32Array([1]))).toThrow()
  expect(() =>
    cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1])),
  ).toThrow()
})
