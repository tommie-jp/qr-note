import { describe, expect, test } from 'vitest'
import {
  applyCompletion,
  longestCommonPrefix,
  matchTags,
  tagContextAtCursor,
} from './tagComplete'

// カーソル位置は | で示し、テストで実インデックスへ変換する。
function at(withCaret: string) {
  const cursor = withCaret.indexOf('|')
  return { query: withCaret.replace('|', ''), cursor }
}

describe('tagContextAtCursor', () => {
  test('detects a tag being typed at the end', () => {
    const { query, cursor } = at('抵抗 #tr|')
    expect(tagContextAtCursor(query, cursor)).toEqual({ start: 3, end: 6, prefix: 'tr' })
  })

  test('detects a bare marker with empty prefix', () => {
    const { query, cursor } = at('#|')
    expect(tagContextAtCursor(query, cursor)).toEqual({ start: 0, end: 1, prefix: '' })
  })

  test('normalizes the prefix (full-width / case)', () => {
    const { query, cursor } = at('#ＮＰ|')
    expect(tagContextAtCursor(query, cursor)?.prefix).toBe('np')
  })

  test('accepts a full-width ＃ marker', () => {
    const { query, cursor } = at('＃タ|')
    expect(tagContextAtCursor(query, cursor)).toMatchObject({ prefix: 'タ' })
  })

  test('extends end over trailing tag chars (mid-token edit)', () => {
    const { query, cursor } = at('#tr|ans')
    expect(tagContextAtCursor(query, cursor)).toEqual({ start: 0, end: 6, prefix: 'tr' })
  })

  test('returns null when the cursor is not after a #', () => {
    const { query, cursor } = at('抵抗 160|8')
    expect(tagContextAtCursor(query, cursor)).toBeNull()
  })

  test('returns null for a mid-word # (C#)', () => {
    const { query, cursor } = at('C#t|')
    expect(tagContextAtCursor(query, cursor)).toBeNull()
  })

  test('returns null inside a quoted literal', () => {
    const { query, cursor } = at('"#t|')
    expect(tagContextAtCursor(query, cursor)).toBeNull()
  })

  test('accepts a tag right after a pipe (OR operator)', () => {
    // `#a|#b` の 2 つ目の # の直後 (末尾) にカーソル
    const q = '#a|#b'
    expect(tagContextAtCursor(q, q.length)).toMatchObject({ prefix: 'b' })
  })

  test('accepts a tag right after an operator (境界は search/tokenize.ts と揃える)', () => {
    // 補完は演算子の直後でも効かないと `(!#np` と打った時点で止まってしまう。
    // `)` も含めるのは、tokenize が `)` でトークンを切る (= 次が先頭になる) ため
    for (const q of ['!#b', '#a !#b', '(#b', '#a (!#b', '！#b', '（#b', '(#a)#b', '#a｜#b']) {
      expect(tagContextAtCursor(q, q.length)).toMatchObject({ prefix: 'b' })
    }
  })

  test('still rejects a mid-word # (C#) even next to parens', () => {
    const q = '(A)C#b'
    expect(tagContextAtCursor(q, q.length)).toBeNull()
  })
})

describe('matchTags', () => {
  const tags = ['transistor', 'trance', 'cap', 'coil']

  test('prefix-filters while keeping input order', () => {
    expect(matchTags('tr', tags)).toEqual(['transistor', 'trance'])
  })

  test('empty prefix returns the head of the list', () => {
    expect(matchTags('', tags, 2)).toEqual(['transistor', 'trance'])
  })

  test('respects the limit', () => {
    expect(matchTags('', tags, 1)).toEqual(['transistor'])
  })

  test('returns empty when nothing matches', () => {
    expect(matchTags('zzz', tags)).toEqual([])
  })
})

describe('longestCommonPrefix', () => {
  test('finds the shared prefix', () => {
    expect(longestCommonPrefix(['transistor', 'trance'])).toBe('tran')
  })

  test('returns the single name as-is', () => {
    expect(longestCommonPrefix(['cap'])).toBe('cap')
  })

  test('returns empty when there is no shared prefix', () => {
    expect(longestCommonPrefix(['cap', 'coil'])).toBe('c')
    expect(longestCommonPrefix(['ab', 'xy'])).toBe('')
  })

  test('returns empty for an empty list', () => {
    expect(longestCommonPrefix([])).toBe('')
  })
})

describe('applyCompletion', () => {
  test('replaces the typed tag and adds a trailing space', () => {
    const { query, cursor } = at('抵抗 #tr|')
    const ctx = tagContextAtCursor(query, cursor)!
    const r = applyCompletion(query, ctx, 'transistor', { addSpace: true })
    expect(r.query).toBe('抵抗 #transistor ')
    expect(r.cursor).toBe(r.query.length)
  })

  test('replaces the whole token when editing mid-token', () => {
    const { query, cursor } = at('#tr|ans')
    const ctx = tagContextAtCursor(query, cursor)!
    const r = applyCompletion(query, ctx, 'transistor')
    expect(r.query).toBe('#transistor')
    expect(r.cursor).toBe('#transistor'.length)
  })

  test('does not double a space that already follows', () => {
    const query = '#tr next'
    const ctx = tagContextAtCursor(query, 3)!
    const r = applyCompletion(query, ctx, 'transistor', { addSpace: true })
    expect(r.query).toBe('#transistor next')
  })

  test('normalizes a full-width marker to #', () => {
    const { query, cursor } = at('＃タ|')
    const ctx = tagContextAtCursor(query, cursor)!
    const r = applyCompletion(query, ctx, 'タグ')
    expect(r.query).toBe('#タグ')
  })
})
