import { describe, expect, test } from 'vitest'
import { insertAtSelection, insertBlockAtSelection } from './insertAtSelection'

describe('insertAtSelection', () => {
  test('replaces the selected range', () => {
    expect(insertAtSelection('abcdef', 2, 4, 'X')).toEqual({
      text: 'abXef',
      cursor: 3,
    })
  })

  test('inserts at a collapsed cursor', () => {
    expect(insertAtSelection('abc', 3, 3, '!')).toEqual({
      text: 'abc!',
      cursor: 4,
    })
  })

  test('clamps a selection that runs past the end (state のずれに耐える)', () => {
    expect(insertAtSelection('abc', 99, 99, 'X')).toEqual({
      text: 'abcX',
      cursor: 4,
    })
  })

  test('accepts a backwards selection (下から上へ選んだとき)', () => {
    expect(insertAtSelection('abcdef', 4, 2, 'X')).toEqual({
      text: 'abXef',
      cursor: 3,
    })
  })
})

describe('insertBlockAtSelection', () => {
  test('starts a new line when the cursor is mid-line', () => {
    expect(insertBlockAtSelection('abc', 3, 3, 'X')).toEqual({
      text: 'abc\nX\n',
      cursor: 6,
    })
  })

  test('does not add a leading newline at the start of a line', () => {
    expect(insertBlockAtSelection('abc\n', 4, 4, 'X')).toEqual({
      text: 'abc\nX\n',
      cursor: 6,
    })
  })

  test('works on an empty document', () => {
    expect(insertBlockAtSelection('', 0, 0, 'X')).toEqual({
      text: 'X\n',
      cursor: 2,
    })
  })
})
