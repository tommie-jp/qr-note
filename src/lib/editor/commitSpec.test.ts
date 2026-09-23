import { isolateHistory } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { commitSpec } from './commitSpec'

// 図の編集 (docs/99) を閉じたとき、殻が書き換えた全文をエディタへ当てる形。
// 当てるのは **1 回だけ** (元に戻す 1 段で開く前へ戻る)

const BEFORE = '# 例\n\n```breadboard\n  R1: resistor a5 a10 330\n```\n\nあとがき。'
const AFTER = BEFORE.replace('330', '1k')

describe('commitSpec', () => {
  test('変わった所だけを 1 か所の変更にする', () => {
    // Arrange
    const state = EditorState.create({ doc: BEFORE })

    // Act
    const result = commitSpec(BEFORE, AFTER, state)

    // Assert
    expect(result.kind).toBe('change')
    if (result.kind !== 'change') return
    expect(result.spec.changes).toEqual({
      from: BEFORE.indexOf('330'),
      to: BEFORE.indexOf('330') + 3,
      insert: '1k',
    })
    expect(state.update(result.spec).state.doc.toString()).toBe(AFTER)
  })

  test('履歴では独り立ちさせる (直前の打鍵とまとめない)', () => {
    const state = EditorState.create({ doc: BEFORE })

    const result = commitSpec(BEFORE, AFTER, state)

    if (result.kind !== 'change') throw new Error('change のはず')
    const tr = state.update(result.spec)
    expect(tr.annotation(isolateHistory)).toBe('full')
  })

  test('何も変わっていなければ当てない', () => {
    const state = EditorState.create({ doc: BEFORE })

    expect(commitSpec(BEFORE, BEFORE, state)).toEqual({ kind: 'unchanged' })
  })

  test('開いている間に本文が動いていたら当てない', () => {
    const state = EditorState.create({ doc: `${BEFORE}\n追記` })

    expect(commitSpec(BEFORE, AFTER, state)).toEqual({ kind: 'stale' })
  })

  test('行が増えても減っても全文が一致する', () => {
    const state = EditorState.create({ doc: BEFORE })
    const grown = BEFORE.replace(
      '  R1: resistor a5 a10 330',
      '  R1: resistor a5 a10 330\n  D1: led b12(A) b13(K) red',
    )

    const result = commitSpec(BEFORE, grown, state)

    if (result.kind !== 'change') throw new Error('change のはず')
    expect(state.update(result.spec).state.doc.toString()).toBe(grown)
  })

  // 頭と尻の一致を数えるとき、重なりを許すと from > to になる
  // (繰り返しの字を 1 つ消したとき)
  test('同じ字の並びから 1 字消しても範囲が逆転しない', () => {
    const before = 'aaaa'
    const state = EditorState.create({ doc: before })

    const result = commitSpec(before, 'aaa', state)

    if (result.kind !== 'change') throw new Error('change のはず')
    expect(state.update(result.spec).state.doc.toString()).toBe('aaa')
  })

  test('全部入れ替わっても当たる', () => {
    const state = EditorState.create({ doc: 'abc' })

    const result = commitSpec('abc', 'xyz', state)

    if (result.kind !== 'change') throw new Error('change のはず')
    expect(state.update(result.spec).state.doc.toString()).toBe('xyz')
  })
})
