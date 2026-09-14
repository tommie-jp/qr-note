import { describe, expect, test } from 'vitest'
import {
  BASE_NEW,
  BASE_STALE,
  formatBase,
  nextVersion,
  parseBase,
} from './saveBase'

describe('formatBase', () => {
  test('行が無ければ new (これから作る、という前提)', () => {
    expect(formatBase(null)).toBe(BASE_NEW)
  })

  test('ある行は updated_at のミリ秒', () => {
    expect(formatBase(new Date(1_787_000_000_123))).toBe('1787000000123')
  })
})

describe('parseBase', () => {
  test('formatBase と往復してもミリ秒が欠けない', () => {
    // Arrange — TIMESTAMP(3) と JS Date はどちらもミリ秒
    const at = new Date(1_787_000_000_123)

    // Act
    const parsed = parseBase(formatBase(at))

    // Assert
    expect(parsed).toEqual({ kind: 'at', at })
  })

  test('new / stale はそのまま印として読む', () => {
    expect(parseBase(BASE_NEW)).toEqual({ kind: 'new' })
    expect(parseBase(BASE_STALE)).toEqual({ kind: 'stale' })
  })

  test.each([
    ['欠落', null],
    ['空文字', ''],
    ['数字でない', 'abc'],
    ['負数', '-1'],
    ['小数', '1.5'],
    ['指数表記 (Number なら通ってしまう)', '1e400'],
    ['前後の空白 (Number なら通ってしまう)', ' 12 '],
    ['16 進 (Number なら通ってしまう)', '0x10'],
    ['Date の範囲外', '8640000000001'.padEnd(17, '0')],
    ['文字列でない (File など)', 123],
  ])('不正な基点は null にして保存を止める: %s', (_label, raw) => {
    expect(parseBase(raw)).toBeNull()
  })
})

describe('nextVersion', () => {
  test('いまが基点より後なら、いまで打つ', () => {
    expect(nextVersion(new Date(1000), 5000).getTime()).toBe(5000)
  })

  test('同じミリ秒に 2 回書いても版が重ならない (ABA を断つ)', () => {
    // Arrange — 直前の書き込みと同じミリ秒に来た
    const prev = new Date(5000)

    // Act
    const next = nextVersion(prev, 5000)

    // Assert
    expect(next.getTime()).toBe(5001)
  })

  test('基点が未来でも必ず 1ms 進める (時計が巻き戻っても単調)', () => {
    expect(nextVersion(new Date(9000), 5000).getTime()).toBe(9001)
  })
})
