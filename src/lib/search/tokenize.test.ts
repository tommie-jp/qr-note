import { describe, expect, test } from 'vitest'
import { tokenize, type Token } from './tokenize'

// 字句解析の層だけを見る。括弧の釣り合い・畳み込み・語数の丸めは
// parse.ts の仕事なので、ここではトークンがそのまま並ぶことを確かめる
const text = (value: string): Token => ({ type: 'term', term: { kind: 'text', value } })
const tag = (value: string): Token => ({ type: 'term', term: { kind: 'tag', value } })
const OR: Token = { type: 'or' }
const NOT: Token = { type: 'not' }
const LPAREN: Token = { type: 'lparen' }
const RPAREN: Token = { type: 'rparen' }

describe('tokenize', () => {
  test('splits on half- and full-width spaces without emitting separators', () => {
    expect(tokenize(' 抵抗　1608 ')).toEqual([text('抵抗'), text('1608')])
  })

  test('emits the OR keyword and pipes (全角も) as or tokens', () => {
    expect(tokenize('A ＯＲ B|C｜D')).toEqual([
      text('A'), OR, text('B'), OR, text('C'), OR, text('D'),
    ])
  })

  test('emits parens as standalone tokens even when packed', () => {
    expect(tokenize('#bjt(!#npn)')).toEqual([
      tag('bjt'), LPAREN, NOT, tag('npn'), RPAREN,
    ])
  })

  test('keeps unbalanced parens as-is (釣り合いはパーサが取る)', () => {
    expect(tokenize(')A(')).toEqual([RPAREN, text('A'), LPAREN])
  })

  test('treats ! as NOT only at the start of a token', () => {
    expect(tokenize('!！a!b')).toEqual([NOT, NOT, text('a!b')])
  })

  test('a quoted token is never promoted to an operator, tag or is: term', () => {
    expect(tokenize('"or" "#tag" "is:todo" "a b"')).toEqual([
      text('or'), text('#tag'), text('is:todo'), text('a b'),
    ])
  })

  test('an empty quote yields no token', () => {
    expect(tokenize('""')).toEqual([])
  })

  test('recognizes is: terms and drops a bare #', () => {
    expect(tokenize('is:todo IS:DONE is:untagged is:foo # ＃')).toEqual([
      { type: 'term', term: { kind: 'task', value: 'todo' } },
      { type: 'term', term: { kind: 'task', value: 'done' } },
      { type: 'term', term: { kind: 'untagged' } },
      text('is:foo'),
    ])
  })
})
