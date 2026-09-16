import { describe, expect, test } from 'vitest'
import { BASE_NEW, BASE_STALE, formatBase, isOlderBase, nextVersion, parseBase } from './saveBase'

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

// 競合の応答はページを再描画しないので、「別の版を読み込む」で揃えた直後の
// props は揃えた版より古いことがある。古い props を「サーバが動いた」と取ると、
// 読み込んだ本文を即座に元へ引き戻す (2026-09-17 に修正)。基点の新旧で見分ける
describe('isOlderBase', () => {
  test('ミリ秒が小さいほうが古い。同じなら古くない', () => {
    expect(isOlderBase('1787000000000', '1787000000001')).toBe(true)
    expect(isOlderBase('1787000000001', '1787000000000')).toBe(false)
    expect(isOlderBase('1787000000000', '1787000000000')).toBe(false)
  })

  test('new (まだ行が無い) は、ある行のどの版よりも古い', () => {
    expect(isOlderBase(BASE_NEW, '1787000000000')).toBe(true)
    expect(isOlderBase('1787000000000', BASE_NEW)).toBe(false)
    expect(isOlderBase(BASE_NEW, BASE_NEW)).toBe(false)
  })

  test('stale や読めない値は新旧を決められないので古いとは言わない', () => {
    expect(isOlderBase(BASE_STALE, '1787000000000')).toBe(false)
    expect(isOlderBase('1787000000000', BASE_STALE)).toBe(false)
    expect(isOlderBase('abc', '1787000000000')).toBe(false)
  })
})
