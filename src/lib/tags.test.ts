import { describe, expect, test } from 'vitest'
import {
  extractTags,
  normalizeTag,
  parseTagToken,
  tagSearchHref,
  tagSearchQuery,
} from './tags'

describe('normalizeTag', () => {
  test('lowercases ASCII', () => {
    expect(normalizeTag('Tag1')).toBe('tag1')
  })

  test('NFKC-folds full-width letters and digits', () => {
    expect(normalizeTag('ＮＰＮ')).toBe('npn')
    expect(normalizeTag('１６０８')).toBe('1608')
  })

  test('keeps Japanese and hyphen/underscore', () => {
    expect(normalizeTag('トランジスタ')).toBe('トランジスタ')
    expect(normalizeTag('part-a_b')).toBe('part-a_b')
  })
})

describe('extractTags', () => {
  test('extracts a single tag', () => {
    expect(extractTags('これは #抵抗 のメモ')).toEqual(['抵抗'])
  })

  test('extracts multiple tags in first-seen order', () => {
    expect(extractTags('#tag1 本文 #tag2')).toEqual(['tag1', 'tag2'])
  })

  test('extracts a tag at the very start of the memo', () => {
    expect(extractTags('#トランジスタ 2SC1815')).toEqual(['トランジスタ'])
  })

  test('extracts a tag at the start of a line', () => {
    expect(extractTags('一行目\n#抵抗 二行目')).toEqual(['抵抗'])
  })

  test('accepts a full-width ＃ marker', () => {
    expect(extractTags('部品 ＃コンデンサ')).toEqual(['コンデンサ'])
  })

  test('normalizes full-width tag names', () => {
    expect(extractTags('#ＮＰＮ と #１６０８')).toEqual(['npn', '1608'])
  })

  test('allows numeric tags (e.g. package size)', () => {
    expect(extractTags('#0603 #1608')).toEqual(['0603', '1608'])
  })

  test('allows hyphen and underscore in tag names', () => {
    expect(extractTags('#part-a #a_b')).toEqual(['part-a', 'a_b'])
  })

  test('de-duplicates repeated tags', () => {
    expect(extractTags('#抵抗 #抵抗 #Tag #tag')).toEqual(['抵抗', 'tag'])
  })

  test('terminates a tag at punctuation', () => {
    expect(extractTags('#抵抗。 #tag, #x!')).toEqual(['抵抗', 'tag', 'x'])
  })

  test('does not treat a Markdown heading (# with a space) as a tag', () => {
    expect(extractTags('# 見出し\n本文')).toEqual([])
    expect(extractTags('## セクション')).toEqual([])
  })

  test('does not treat a URL fragment as a tag', () => {
    expect(extractTags('見て https://example.com/page#section よ')).toEqual([])
  })

  test('does not treat a mid-word # as a tag (C#)', () => {
    expect(extractTags('言語は C# です')).toEqual([])
  })

  test('ignores tags inside inline code', () => {
    expect(extractTags('コードは `#include <stdio.h>` です')).toEqual([])
  })

  test('ignores tags inside a fenced code block', () => {
    const memo = '説明\n\n```bash\n# comment\ngrep "#tag"\n```\n\n#実タグ'
    expect(extractTags(memo)).toEqual(['実タグ'])
  })

  test('ignores a bare # with no tag name', () => {
    expect(extractTags('記号 # だけ')).toEqual([])
  })

  test('returns an empty array for a memo with no tags', () => {
    expect(extractTags('ただの本文です')).toEqual([])
  })
})

describe('parseTagToken', () => {
  test('returns the normalized name for a tag token', () => {
    expect(parseTagToken('#tag1')).toBe('tag1')
    expect(parseTagToken('＃ＮＰＮ')).toBe('npn')
  })

  test('returns null for a bare # marker', () => {
    expect(parseTagToken('#')).toBeNull()
    expect(parseTagToken('＃')).toBeNull()
  })

  test('returns null for a non-tag token', () => {
    expect(parseTagToken('抵抗')).toBeNull()
    expect(parseTagToken('C#')).toBeNull()
  })

  test('returns null when the token has trailing non-tag characters', () => {
    expect(parseTagToken('#tag#foo')).toBeNull()
    expect(parseTagToken('#tag.')).toBeNull()
  })
})

describe('tagSearchHref', () => {
  test('builds a tag search URL with the # prefix percent-encoded', () => {
    expect(tagSearchHref('bjt')).toBe('/?q=%23bjt')
  })

  test('percent-encodes multibyte tag names', () => {
    expect(tagSearchHref('抵抗')).toBe('/?q=%23%E6%8A%B5%E6%8A%97')
  })
})

describe('tagSearchQuery', () => {
  test('reads back what tagSearchHref built', () => {
    expect(tagSearchQuery(tagSearchHref('過渡現象'))).toBe('#過渡現象')
    expect(tagSearchQuery(tagSearchHref('bjt'))).toBe('#bjt')
  })

  test('ignores a search that is not a single tag', () => {
    expect(tagSearchQuery('/?q=%E6%8A%B5%E6%8A%97')).toBeNull() // ただの語
    expect(tagSearchQuery('/?q=%23a+%23b')).toBeNull() // タグ 2 つ
    expect(tagSearchQuery('/?q=%23')).toBeNull() // タグ名が空
  })

  test('ignores paging and back links (they continue the current search)', () => {
    expect(tagSearchQuery('/?q=%23bjt&page=2')).toBeNull()
    expect(tagSearchQuery('/?q=%23bjt&sort=accessed')).toBeNull()
  })

  test('ignores links that are not a search', () => {
    expect(tagSearchQuery('/item/1085')).toBeNull()
    expect(tagSearchQuery('/')).toBeNull()
    expect(tagSearchQuery('https://example.com/?q=%23bjt')).toBeNull()
    expect(tagSearchQuery(null)).toBeNull()
    expect(tagSearchQuery(undefined)).toBeNull()
  })
})
