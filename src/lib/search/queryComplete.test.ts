import { describe, expect, test } from 'vitest'
import { insideQuote, isTokenBoundary, replaceRange } from './queryComplete'

describe('isTokenBoundary', () => {
  test('treats the start of the string as a boundary', () => {
    expect(isTokenBoundary(undefined)).toBe(true)
  })

  test('treats spaces and operators as boundaries', () => {
    for (const ch of [' ', '　', '|', '｜', '!', '！', '(', ')', '（', '）']) {
      expect(isTokenBoundary(ch)).toBe(true)
    }
  })

  test('treats word characters as inside a token', () => {
    for (const ch of ['a', '抵', '#', ':', '-']) {
      expect(isTokenBoundary(ch)).toBe(false)
    }
  })
})

describe('insideQuote', () => {
  test('is false before any quote', () => {
    expect(insideQuote('abc', 3)).toBe(false)
  })

  test('is true after an opening quote', () => {
    expect(insideQuote('"abc', 4)).toBe(true)
  })

  test('is false again after the closing quote', () => {
    expect(insideQuote('"abc" d', 7)).toBe(false)
  })
})

describe('replaceRange', () => {
  test('replaces the range and puts the caret after the insert', () => {
    // Arrange
    const query = '抵抗 #tr'

    // Act
    const r = replaceRange(query, { start: 3, end: 6 }, '#transistor')

    // Assert
    expect(r).toEqual({ query: '抵抗 #transistor', cursor: 14 })
  })

  test('keeps the text after the range', () => {
    const r = replaceRange('#tr 100k', { start: 0, end: 3 }, '#transistor')

    expect(r).toEqual({ query: '#transistor 100k', cursor: 11 })
  })

  test('adds a trailing space so the next word can be typed', () => {
    const r = replaceRange('#tr', { start: 0, end: 3 }, '#transistor', { addSpace: true })

    expect(r).toEqual({ query: '#transistor ', cursor: 12 })
  })

  test('does not double the space when one already follows', () => {
    const r = replaceRange('#tr 100k', { start: 0, end: 3 }, '#transistor', { addSpace: true })

    expect(r).toEqual({ query: '#transistor 100k', cursor: 11 })
  })

  test('treats a full-width space as an existing separator', () => {
    const r = replaceRange('#tr　100k', { start: 0, end: 3 }, '#tag', { addSpace: true })

    expect(r).toEqual({ query: '#tag　100k', cursor: 4 })
  })
})
