import { describe, expect, test } from 'vitest'
import { joinLines, newlineOf, splitLines } from './memoLines'

describe('newlineOf', () => {
  test('CRLF を含む本文は CRLF', () => {
    expect(newlineOf('a\r\nb')).toBe('\r\n')
  })

  test('LF だけ・改行なしは LF', () => {
    expect(newlineOf('a\nb')).toBe('\n')
    expect(newlineOf('a')).toBe('\n')
  })
})

describe('splitLines', () => {
  test('CRLF でも LF でも行に分ける', () => {
    expect(splitLines('a\r\nb\nc')).toEqual(['a', 'b', 'c'])
  })
})

describe('joinLines', () => {
  test('元の本文の改行コードでつなぐ', () => {
    expect(joinLines(['a', 'b'], 'x\r\ny')).toBe('a\r\nb')
    expect(joinLines(['a', 'b'], 'x\ny')).toBe('a\nb')
  })

  test('分けてつなぎ直すと改行コードが揃う', () => {
    const memo = 'a\r\nb\r\nc'
    expect(joinLines(splitLines(memo), memo)).toBe(memo)
  })
})
