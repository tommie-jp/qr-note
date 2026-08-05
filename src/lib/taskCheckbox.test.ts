import { describe, expect, test } from 'vitest'
import { toggleTaskLine } from './taskCheckbox'

describe('toggleTaskLine', () => {
  test('チェックを付ける (- [ ] → - [x])', () => {
    expect(toggleTaskLine('- [ ] apple', 1, true)).toBe('- [x] apple')
  })

  test('チェックを外す (- [x] → - [ ])', () => {
    expect(toggleTaskLine('- [x] apple', 1, false)).toBe('- [ ] apple')
  })

  test('大文字の [X] も外せる (書き込みは小文字 x に揃える)', () => {
    expect(toggleTaskLine('- [X] apple', 1, false)).toBe('- [ ] apple')
    expect(toggleTaskLine('- [X] apple', 1, true)).toBe('- [x] apple')
  })

  test('指定した行だけを書き換える', () => {
    const memo = ['- [ ] apple', '- [ ] apple', '- [ ] apple'].join('\n')
    expect(toggleTaskLine(memo, 2, true)).toBe(
      ['- [ ] apple', '- [x] apple', '- [ ] apple'].join('\n'),
    )
  })

  test('既に望む状態なら本文はそのまま返す (エラーにしない)', () => {
    expect(toggleTaskLine('- [x] apple', 1, true)).toBe('- [x] apple')
    expect(toggleTaskLine('- [ ] apple', 1, false)).toBe('- [ ] apple')
  })

  test('* と + の箇条書き記号も受ける', () => {
    expect(toggleTaskLine('* [ ] apple', 1, true)).toBe('* [x] apple')
    expect(toggleTaskLine('+ [ ] apple', 1, true)).toBe('+ [x] apple')
  })

  test('番号付きリスト (1. / 1)) も受ける', () => {
    expect(toggleTaskLine('1. [ ] apple', 1, true)).toBe('1. [x] apple')
    expect(toggleTaskLine('10) [ ] apple', 1, true)).toBe('10) [x] apple')
  })

  test('入れ子 (インデント) の項目も受ける', () => {
    const memo = ['- [ ] 親', '  - [ ] 子'].join('\n')
    expect(toggleTaskLine(memo, 2, true)).toBe(['- [ ] 親', '  - [x] 子'].join('\n'))
  })

  test('引用の中の項目も受ける', () => {
    expect(toggleTaskLine('> - [ ] apple', 1, true)).toBe('> - [x] apple')
    expect(toggleTaskLine('> > - [ ] apple', 1, true)).toBe('> > - [x] apple')
  })

  test('項目の間に空行があるゆるいリストも受ける', () => {
    const memo = ['- [ ] apple', '', '- [ ] banana'].join('\n')
    expect(toggleTaskLine(memo, 3, true)).toBe(
      ['- [ ] apple', '', '- [x] banana'].join('\n'),
    )
  })

  test('記号の後の空白が複数でもタブでも受ける', () => {
    expect(toggleTaskLine('-   [ ] apple', 1, true)).toBe('-   [x] apple')
    expect(toggleTaskLine('-\t[ ] apple', 1, true)).toBe('-\t[x] apple')
  })

  test('CRLF のメモは改行コードを保つ', () => {
    const memo = '- [ ] apple\r\n- [ ] banana'
    expect(toggleTaskLine(memo, 2, true)).toBe('- [ ] apple\r\n- [x] banana')
  })

  // --- 弾くもの (null = その行はタスク項目ではない) ---

  test('タスク項目でない行は null', () => {
    expect(toggleTaskLine('ふつうの文章', 1, true)).toBeNull()
    expect(toggleTaskLine('- ただの箇条書き', 1, true)).toBeNull()
  })

  test('コードフェンスの中の擬似タスクは null (パーサに聞くので騙されない)', () => {
    const memo = ['```text', '- [ ] apple', '```'].join('\n')
    expect(toggleTaskLine(memo, 2, true)).toBeNull()
  })

  test('4 個以上のインデントで始まるコードブロックの中も null', () => {
    const memo = ['ふつうの文章', '', '    - [ ] apple'].join('\n')
    expect(toggleTaskLine(memo, 3, true)).toBeNull()
  })

  test('GFM がタスクと認めない書き方は null', () => {
    // 括弧の後に空白が要る / 括弧の中身が空はタスクではない
    expect(toggleTaskLine('- [ ]apple', 1, true)).toBeNull()
    expect(toggleTaskLine('- [] apple', 1, true)).toBeNull()
  })

  test('範囲外・不正な行番号は null', () => {
    expect(toggleTaskLine('- [ ] apple', 2, true)).toBeNull()
    expect(toggleTaskLine('- [ ] apple', 0, true)).toBeNull()
    expect(toggleTaskLine('- [ ] apple', -1, true)).toBeNull()
    expect(toggleTaskLine('- [ ] apple', 1.5, true)).toBeNull()
    expect(toggleTaskLine('- [ ] apple', Number.NaN, true)).toBeNull()
  })

  test('本文が変わって別物になった行は null (行番号は当たっても中身が違う)', () => {
    const memo = ['# 見出し', 'ふつうの文章'].join('\n')
    expect(toggleTaskLine(memo, 2, true)).toBeNull()
  })
})
