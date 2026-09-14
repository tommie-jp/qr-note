import { describe, expect, test } from 'vitest'
import {
  hasRowText,
  rowFace,
  rowPreview,
  rowTintClass,
  rowTitle,
  showsRowTags,
  stretchedLinkClass,
} from './itemRowDecor'

const IMAGE = '0421547b-ee29-4613-a6d4-da0f41f94054.jpg'
const VIDEO = '0421547b-ee29-4613-a6d4-da0f41f94054.mp4'
const SVG = '<svg viewBox="0 0 10 10"></svg>'

const memoNote = (memo: string) => ({ mode: 'memo' as const, url: '', memo })
const urlNote = (url: string) => ({ mode: 'url' as const, url, memo: '' })

describe('rowTitle', () => {
  test('本文の 1 行目を要約して見出しにする', () => {
    // Act
    const title = rowTitle(memoNote('# BJT NPN\n本文'))

    // Assert
    expect(title).toEqual({ kind: 'plain', text: 'BJT NPN' })
  })

  test('URL モードは URL を見出しにする', () => {
    // Act / Assert
    expect(rowTitle(urlNote('https://example.com/x'))).toEqual({
      kind: 'plain',
      text: 'https://example.com/x',
    })
  })

  test('見出しが空なら当たり判定のために代わりの文字を置く', () => {
    // Act / Assert
    expect(rowTitle(memoNote(''))).toEqual({ kind: 'plain', text: '(空のノート)' })
    expect(rowTitle(urlNote(''))).toEqual({ kind: 'plain', text: '(空のノート)' })
  })

  test('mathTitle があれば KaTeX の HTML を優先する', () => {
    // Act / Assert
    expect(rowTitle(memoNote('$E=100$'), '<span class="katex">E</span>')).toEqual({
      kind: 'math',
      html: '<span class="katex">E</span>',
    })
  })

  test('mathTitle が空文字なら素の見出しに落とす', () => {
    // Act / Assert
    expect(rowTitle(memoNote('抵抗'), '')).toEqual({ kind: 'plain', text: '抵抗' })
  })
})

describe('rowPreview / hasRowText', () => {
  test('1 行目を除いた本文をプレビューにする', () => {
    // Act
    const preview = rowPreview(memoNote('USB充電器\n#usb\n出力は 5V 3A'))

    // Assert
    expect(preview).toEqual({ kind: 'plain', text: '出力は 5V 3A' })
    expect(hasRowText(preview)).toBe(true)
  })

  test('URL モードは本文を持たないので出さない', () => {
    // Act
    const preview = rowPreview(urlNote('https://example.com/x'))

    // Assert
    expect(preview).toEqual({ kind: 'plain', text: '' })
    expect(hasRowText(preview)).toBe(false)
  })

  test('mathPreview があれば KaTeX の HTML を出す', () => {
    // Act
    const preview = rowPreview(memoNote('題\n$I=E/R$'), '<span>I</span>')

    // Assert
    expect(preview).toEqual({ kind: 'math', html: '<span>I</span>' })
    expect(hasRowText(preview)).toBe(true)
  })
})

describe('rowFace', () => {
  test('画像があれば画像を顔にする (回路図・プレビューより優先)', () => {
    // Act
    const face = rowFace(memoNote(`写真\n![](/api/images/${IMAGE})`), {
      circuitThumb: SVG,
      hasNotePreview: true,
    })

    // Assert
    expect(face).toEqual({ kind: 'image', name: IMAGE, isVideo: false })
  })

  test('動画は poster を出すので isVideo を立てる', () => {
    // Act
    const face = rowFace(memoNote(`![](/api/images/${VIDEO})`), { hasNotePreview: false })

    // Assert
    expect(face).toEqual({ kind: 'image', name: VIDEO, isVideo: true })
  })

  test('画像が無ければ回路図、それも無ければノート全体プレビュー', () => {
    // Act
    const circuit = rowFace(memoNote('RC 回路'), { circuitThumb: SVG, hasNotePreview: true })
    const preview = rowFace(memoNote('文字だけ'), { hasNotePreview: true })
    const none = rowFace(memoNote('文字だけ'), { hasNotePreview: false })

    // Assert
    expect(circuit).toEqual({ kind: 'circuit', svg: SVG })
    expect(preview).toEqual({ kind: 'preview' })
    expect(none).toBeNull()
  })

  test('URL モードは本文の画像を見ない', () => {
    // Arrange
    const item = { mode: 'url' as const, url: `/api/images/${IMAGE}`, memo: `![](/api/images/${IMAGE})` }

    // Act / Assert
    expect(rowFace(item, { hasNotePreview: false })).toBeNull()
  })
})

describe('showsRowTags', () => {
  test('小表示ではタグを出さず、中・大ではタグがあるときだけ出す', () => {
    // Act / Assert
    expect(showsRowTags('compact', ['bjt'])).toBe(false)
    expect(showsRowTags('medium', ['bjt'])).toBe(true)
    expect(showsRowTags('card', ['bjt'])).toBe(true)
    expect(showsRowTags('card', [])).toBe(false)
  })
})

describe('stretchedLinkClass / rowTintClass', () => {
  test('選択モードでは当たり判定の膜を敷かない', () => {
    // Act / Assert
    expect(stretchedLinkClass(false)).toBe('after:absolute after:inset-0')
    expect(stretchedLinkClass(true)).toBe('')
  })

  test('プレビュー中の行は hover ごと選択色に寄せる', () => {
    // Act
    const selected = rowTintClass(true)
    const plain = rowTintClass(false)

    // Assert
    expect(selected).toContain('hover:bg-[var(--row-tint-bg)]')
    expect(selected).not.toContain('bg-gray-50')
    expect(plain).toBe('hover:bg-gray-50 active:bg-gray-100')
  })
})
