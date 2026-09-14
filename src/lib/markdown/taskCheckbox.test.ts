import { describe, expect, test } from 'vitest'
import {
  checkStates,
  countTasks,
  differsOnlyInTaskMarks,
  toggleTaskLine,
} from './taskCheckbox'

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

describe('countTasks', () => {
  test('未チェックとチェック済みを数える', () => {
    const memo = ['- [ ] apple', '- [x] banana', '- [ ] cherry'].join('\n')
    expect(countTasks(memo)).toEqual({ todo: 2, done: 1 })
  })

  test('大文字の [X] もチェック済みとして数える', () => {
    expect(countTasks('- [X] apple')).toEqual({ todo: 0, done: 1 })
  })

  test('タスク項目が無ければ 0/0', () => {
    expect(countTasks('ふつうの文章\n- ただの箇条書き')).toEqual({
      todo: 0,
      done: 0,
    })
    expect(countTasks('')).toEqual({ todo: 0, done: 0 })
  })

  test('コードフェンスの中の擬似タスクは数えない', () => {
    const memo = ['```text', '- [ ] apple', '```', '', '- [ ] real'].join('\n')
    expect(countTasks(memo)).toEqual({ todo: 1, done: 0 })
  })

  test('入れ子・引用・番号付きも数える', () => {
    const memo = [
      '- [ ] 親',
      '  - [x] 子',
      '',
      '> - [ ] 引用',
      '',
      '1. [x] 番号付き',
    ].join('\n')
    expect(countTasks(memo)).toEqual({ todo: 2, done: 2 })
  })

  test('折りたたみ (:::details) を挟んでも数え違えない', () => {
    // 単語帳の書き方 (docs/56-チェック検索計画.md)。remark-directive を
    // 通していないパーサでも ::: 行はただの段落なので、数には影響しない
    const memo = [
      '- [ ] word1',
      ':::details[word1]',
      '日本語訳1',
      ':::',
      '- [x] word2',
      ':::details[word2]',
      '日本語訳2',
      ':::',
    ].join('\n')
    expect(countTasks(memo)).toEqual({ todo: 1, done: 1 })
  })

  test('CRLF のメモでも数えられる', () => {
    expect(countTasks('- [ ] apple\r\n- [x] banana')).toEqual({
      todo: 1,
      done: 1,
    })
  })
})

describe('checkStates', () => {
  test('チェック項目の名前と状態を文書順に返す', () => {
    const memo = ['- [x] 学習済み', '- [ ] 自信あり'].join('\n')
    expect(checkStates(memo)).toEqual([
      { label: '学習済み', checked: true },
      { label: '自信あり', checked: false },
    ])
  })

  test('タスクでない箇条書きは拾わない', () => {
    const memo = ['- ただの項目', '- [ ] 学習済み'].join('\n')
    expect(checkStates(memo)).toEqual([{ label: '学習済み', checked: false }])
  })

  // countTasks と同じ物差し (パーサ基準) にする。押せるもの = 数えるもの
  test('コードフェンスの中の擬似タスクは拾わない', () => {
    const memo = ['```text', '- [ ] 見た目だけ', '```', '- [x] 学習済み'].join('\n')
    expect(checkStates(memo)).toEqual([{ label: '学習済み', checked: true }])
  })

  test('強調やインラインコードは中の文字だけ拾う', () => {
    expect(checkStates('- [ ] **学習**`済み`')).toEqual([
      { label: '学習済み', checked: false },
    ])
  })

  // 外側の項目のラベルに内側の項目の文字が混ざると、名前が一致しなくなる
  test('入れ子のタスクは別々の項目として拾う', () => {
    const memo = ['- [ ] 親', '  - [x] 子'].join('\n')
    expect(checkStates(memo)).toEqual([
      { label: '親', checked: false },
      { label: '子', checked: true },
    ])
  })

  test('空行入りのゆるいリストでも拾える', () => {
    const memo = ['- [x] 学習済み', '', '- [ ] 自信あり'].join('\n')
    expect(checkStates(memo)).toEqual([
      { label: '学習済み', checked: true },
      { label: '自信あり', checked: false },
    ])
  })

  test('番号付き・引用の中のタスクも拾う', () => {
    const memo = ['1. [x] 学習済み', '> - [ ] 自信あり'].join('\n')
    expect(checkStates(memo)).toEqual([
      { label: '学習済み', checked: true },
      { label: '自信あり', checked: false },
    ])
  })

  test('名前の前後の空白は落とす', () => {
    expect(checkStates('- [ ] 学習済み  ')).toEqual([
      { label: '学習済み', checked: false },
    ])
  })

  test('チェックが無ければ空', () => {
    expect(checkStates('ただの本文')).toEqual([])
  })
})

describe('differsOnlyInTaskMarks', () => {
  test('チェック印だけが違う本文どうしは true (再適用してよい)', () => {
    // Arrange — 別の端末がチェックを 1 つ裏返しただけ
    const first = ['- [ ] 学習済み', '- [ ] 自信あり'].join('\n')
    const current = ['- [x] 学習済み', '- [ ] 自信あり'].join('\n')

    // Act & Assert
    expect(differsOnlyInTaskMarks(first, current)).toBe(true)
  })

  test('同じ本文も true', () => {
    const memo = '- [x] 学習済み'
    expect(differsOnlyInTaskMarks(memo, memo)).toBe(true)
  })

  test('行が増えていれば false (行番号がずれるので再適用しない)', () => {
    // Arrange — 押している間に別の端末が 1 行足した。行番号で指す操作は
    // ずれた先が偶然タスク行だと、別の項目を裏返してしまう
    const first = ['- [ ] 学習済み', '- [ ] 自信あり'].join('\n')
    const current = ['新しい見出し', '- [ ] 学習済み', '- [ ] 自信あり'].join('\n')

    // Act & Assert
    expect(differsOnlyInTaskMarks(first, current)).toBe(false)
  })

  test('本文が書き換わっていれば false', () => {
    const first = '- [ ] 学習済み'
    const current = '- [ ] 学習ずみ'
    expect(differsOnlyInTaskMarks(first, current)).toBe(false)
  })

  test('行末の違い (CRLF / LF) は同じと見なさない', () => {
    // 保存経路が本文を LF に正規化するので、行末が違えば「本文が変わった」
    expect(differsOnlyInTaskMarks('- [ ] a\r\n- [ ] b', '- [ ] a\n- [ ] b')).toBe(false)
  })

  test('コードフェンスの中の擬似タスクも印として揃える (安全側)', () => {
    // ここは行番号のずれを見る門番であって、押せるかどうかの判定ではない。
    // 見た目がタスク行なら揃えておく方が、誤って再適用を許すより安全側に倒れる
    const first = ['```text', '- [ ] 見た目だけ', '```'].join('\n')
    const current = ['```text', '- [x] 見た目だけ', '```'].join('\n')
    expect(differsOnlyInTaskMarks(first, current)).toBe(true)
  })
})
