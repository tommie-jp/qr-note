import { describe, expect, it } from 'vitest'
import { splitTitleLinks } from './titleLinks'

describe('splitTitleLinks', () => {
  it('returns one text part when the title has no URL', () => {
    expect(splitTitleLinks('会議')).toEqual([{ kind: 'text', text: '会議' }])
  })

  it('returns no parts for an empty title', () => {
    expect(splitTitleLinks('')).toEqual([])
  })

  it('returns one url part when the title is only a URL', () => {
    expect(splitTitleLinks('https://example.com/a?b=1#c')).toEqual([
      { kind: 'url', text: 'https://example.com/a?b=1#c' },
    ])
  })

  it('splits a URL surrounded by Japanese text', () => {
    expect(splitTitleLinks('打合せ https://meet.example.com/xyz の予定')).toEqual([
      { kind: 'text', text: '打合せ ' },
      { kind: 'url', text: 'https://meet.example.com/xyz' },
      { kind: 'text', text: ' の予定' },
    ])
  })

  it('ends a URL at the first non-ASCII character', () => {
    expect(splitTitleLinks('資料http://example.com/docを見る')).toEqual([
      { kind: 'text', text: '資料' },
      { kind: 'url', text: 'http://example.com/doc' },
      { kind: 'text', text: 'を見る' },
    ])
  })

  it('finds several URLs', () => {
    const parts = splitTitleLinks('https://a.example.com と https://b.example.com')
    expect(parts.filter((p) => p.kind === 'url').map((p) => p.text)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })

  it('leaves trailing punctuation out of the URL', () => {
    expect(splitTitleLinks('see https://example.com/a.')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'url', text: 'https://example.com/a' },
      { kind: 'text', text: '.' },
    ])
  })

  it('leaves an unbalanced closing parenthesis out of the URL', () => {
    expect(splitTitleLinks('(https://example.com/a)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'url', text: 'https://example.com/a' },
      { kind: 'text', text: ')' },
    ])
  })

  it('keeps a balanced parenthesis inside the URL', () => {
    expect(splitTitleLinks('https://en.example.org/wiki/A_(b)')).toEqual([
      { kind: 'url', text: 'https://en.example.org/wiki/A_(b)' },
    ])
  })

  it('accepts an upper-case scheme', () => {
    expect(splitTitleLinks('HTTPS://EXAMPLE.COM')).toEqual([{ kind: 'url', text: 'HTTPS://EXAMPLE.COM' }])
  })

  it('does not link other schemes', () => {
    expect(splitTitleLinks('javascript:alert(1) mailto:a@example.com')).toEqual([
      { kind: 'text', text: 'javascript:alert(1) mailto:a@example.com' },
    ])
  })

  it('does not link a scheme with no host', () => {
    expect(splitTitleLinks('https:// だけ')).toEqual([{ kind: 'text', text: 'https:// だけ' }])
  })
})
