import { describe, expect, test } from 'vitest'
import {
  keywordContextAtCursor,
  matchKeywords,
  SEARCH_KEYWORDS,
} from './keywordComplete'

// カーソル位置は | で示し、テストで実インデックスへ変換する
// (tagComplete.test.ts と同じ書き方)。
function at(withCaret: string) {
  const cursor = withCaret.indexOf('|')
  return { query: withCaret.replace('|', ''), cursor }
}

describe('keywordContextAtCursor', () => {
  test('picks up a word being typed at the end', () => {
    // Arrange
    const { query, cursor } = at('i|')

    // Act
    const ctx = keywordContextAtCursor(query, cursor)

    // Assert
    expect(ctx).toEqual({ start: 0, end: 1, prefix: 'i' })
  })

  test('picks up a word after another term', () => {
    const { query, cursor } = at('抵抗 is|')

    expect(keywordContextAtCursor(query, cursor)).toEqual({ start: 3, end: 5, prefix: 'is' })
  })

  test('includes the colon in the prefix', () => {
    const { query, cursor } = at('is:t|')

    expect(keywordContextAtCursor(query, cursor)).toEqual({ start: 0, end: 4, prefix: 'is:t' })
  })

  test('lowercases the prefix so IS: also completes', () => {
    const { query, cursor } = at('IS:T|')

    expect(keywordContextAtCursor(query, cursor)?.prefix).toBe('is:t')
  })

  test('starts after a negation operator', () => {
    const { query, cursor } = at('!i|')

    expect(keywordContextAtCursor(query, cursor)).toEqual({ start: 1, end: 2, prefix: 'i' })
  })

  test('starts after an opening parenthesis', () => {
    const { query, cursor } = at('(i|')

    expect(keywordContextAtCursor(query, cursor)).toMatchObject({ start: 1, prefix: 'i' })
  })

  test('extends the end over trailing word chars (mid-token edit)', () => {
    const { query, cursor } = at('is|:todo')

    expect(keywordContextAtCursor(query, cursor)).toEqual({ start: 0, end: 7, prefix: 'is' })
  })

  test('returns null on an empty token', () => {
    const { query, cursor } = at('抵抗 |')

    expect(keywordContextAtCursor(query, cursor)).toBeNull()
  })

  test('returns null inside a quote (literal search)', () => {
    const { query, cursor } = at('"i|')

    expect(keywordContextAtCursor(query, cursor)).toBeNull()
  })

  test('returns null on a tag token (tag completion owns it)', () => {
    const { query, cursor } = at('#i|')

    expect(keywordContextAtCursor(query, cursor)).toBeNull()
  })
})

describe('matchKeywords', () => {
  test('offers all is: keywords from a single i', () => {
    expect(matchKeywords('i')).toEqual(['is:todo', 'is:done', 'is:untagged'])
  })

  test('narrows down as the word grows', () => {
    expect(matchKeywords('is:t')).toEqual(['is:todo'])
    expect(matchKeywords('is:u')).toEqual(['is:untagged'])
  })

  test('returns nothing when the word is already a whole keyword', () => {
    expect(matchKeywords('is:todo')).toEqual([])
  })

  test('returns nothing for an unrelated word', () => {
    expect(matchKeywords('抵抗')).toEqual([])
  })

  test('returns nothing for an empty prefix (would show on every space)', () => {
    expect(matchKeywords('')).toEqual([])
  })

  test('every keyword is documented as a search term', () => {
    expect(SEARCH_KEYWORDS).toContain('is:todo')
    expect(SEARCH_KEYWORDS).toContain('is:done')
    expect(SEARCH_KEYWORDS).toContain('is:untagged')
  })
})
