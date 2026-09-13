import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { blockText, insertTextSpec, replaceTokenSpec } from './cmDoc'

const stateAt = (doc: string, anchor: number, head = anchor) =>
  EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })

describe('insertTextSpec', () => {
  test('カーソル位置へ差し込み、カーソルを差し込んだ文字の直後へ置く', () => {
    // Arrange
    const state = stateAt('abc', 1)

    // Act
    const next = state.update(insertTextSpec(state, 'XY')).state

    // Assert
    expect(next.doc.toString()).toBe('aXYbc')
    expect(next.selection.main.head).toBe(3)
  })

  test('選択範囲は置き換える', () => {
    // Arrange
    const state = stateAt('hello world', 0, 5)

    // Act
    const next = state.update(insertTextSpec(state, 'bye')).state

    // Assert
    expect(next.doc.toString()).toBe('bye world')
    expect(next.selection.main.anchor).toBe(3)
  })
})

describe('replaceTokenSpec', () => {
  // アップロード中に本文が動いても、文字列一致で正しい場所を差し替える
  test('位置ではなく文字列で探して置き換える', () => {
    // Arrange
    const token = '![アップロード中 1]()'
    const state = stateAt(`typed first\n${token}\nafter`, 0)

    // Act
    const spec = replaceTokenSpec(state, token, '![](/api/images/a.png)')
    const next = spec === null ? state : state.update(spec).state

    // Assert
    expect(next.doc.toString()).toBe('typed first\n![](/api/images/a.png)\nafter')
  })

  test('プレースホルダが消されていたら null', () => {
    // Arrange
    const state = stateAt('nothing here', 0)

    // Act / Assert
    expect(replaceTokenSpec(state, '![アップロード中 1]()', 'x')).toBeNull()
  })

  test('空文字で置き換えれば取り除ける', () => {
    // Arrange
    const state = stateAt('a\n\n> ⏳ OCR処理中 1…', 0)

    // Act
    const spec = replaceTokenSpec(state, '\n\n> ⏳ OCR処理中 1…', '')
    const next = spec === null ? state : state.update(spec).state

    // Assert
    expect(next.doc.toString()).toBe('a')
  })
})

describe('blockText', () => {
  test('行の途中なら改行で始め、末尾にも改行を足す', () => {
    expect(blockText(stateAt('abc', 3), '#tag')).toBe('\n#tag\n')
  })

  test('行頭なら改行で始めない', () => {
    expect(blockText(stateAt('abc\n', 4), '#tag')).toBe('#tag\n')
  })

  test('本文の先頭なら改行で始めない', () => {
    expect(blockText(stateAt('abc', 0), '#tag')).toBe('#tag\n')
  })
})
