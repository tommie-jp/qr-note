import { expect, test } from 'vitest'
import { formatBytes, formatDuration, formatPercent } from './formatBytes'

test('1024 未満はバイトのまま', () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(1023)).toBe('1023 B')
})

test('1024 刻みで単位を上げ、小数 1 桁にする', () => {
  expect(formatBytes(1024)).toBe('1.0 KB')
  expect(formatBytes(1536)).toBe('1.5 KB')
  expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  expect(formatBytes(1.25 * 1024 ** 3)).toBe('1.3 GB')
  expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 TB')
})

test('bigint も受ける (pg_database_size は bigint で返る)', () => {
  expect(formatBytes(BigInt(2048))).toBe('2.0 KB')
})

test('割合は分母 0 なら「-」', () => {
  expect(formatPercent(1, 4)).toBe('25%')
  expect(formatPercent(0, 0)).toBe('-')
})

test('秒を 日/時/分 に畳む', () => {
  expect(formatDuration(59)).toBe('0 分')
  expect(formatDuration(60)).toBe('1 分')
  expect(formatDuration(3600 * 5 + 60 * 7)).toBe('5 時間 7 分')
  expect(formatDuration(86400 * 3 + 3600 * 2)).toBe('3 日 2 時間 0 分')
})
