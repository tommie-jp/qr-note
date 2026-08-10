import { describe, expect, test } from 'vitest'
import { parseMarkdownTable, splitTableRow } from './markdownTable'

describe('splitTableRow', () => {
  test('前後のパイプは飾りとして落とす', () => {
    expect(splitTableRow('| a | b |')).toEqual(['a', 'b'])
  })

  test('前後のパイプが無くても読む (GFM では省略できる)', () => {
    expect(splitTableRow('a | b')).toEqual(['a', 'b'])
  })

  test('逃がしたパイプは区切りにしない', () => {
    // 表の中に `|` そのものを書く唯一の手段。ここを取り違えると列がずれる
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
  })

  test('空のセルも数える (列がずれないように)', () => {
    expect(splitTableRow('| a |  | c |')).toEqual(['a', '', 'c'])
  })
})

describe('parseMarkdownTable', () => {
  test('見出し・寄せ・中身を読む', () => {
    const table = parseMarkdownTable('| 名前 | 数量 |\n| :--- | ---: |\n| りんご | 3 |')
    expect(table).toEqual({
      header: ['名前', '数量'],
      aligns: ['left', 'right'],
      rows: [['りんご', '3']],
    })
  })

  test('中央寄せを読む', () => {
    expect(parseMarkdownTable('| a |\n| :-: |\n| 1 |')?.aligns).toEqual(['center'])
  })

  test('寄せ指定が無ければ null', () => {
    expect(parseMarkdownTable('| a |\n| --- |\n| 1 |')?.aligns).toEqual([null])
  })

  test('中身が無い表 (見出しだけ) も読む', () => {
    expect(parseMarkdownTable('| a | b |\n| --- | --- |')?.rows).toEqual([])
  })

  test('セルが足りない行は空で埋める', () => {
    // 列がずれると表が崩れて見えるので、見出しの列数に揃える
    expect(parseMarkdownTable('| a | b |\n| - | - |\n| 1 |')?.rows).toEqual([['1', '']])
  })

  test('セルが多い行は切り詰める', () => {
    expect(parseMarkdownTable('| a |\n| - |\n| 1 | 2 |')?.rows).toEqual([['1']])
  })

  test('区切り行が無ければ表ではない', () => {
    expect(parseMarkdownTable('| a | b |\n| 1 | 2 |')).toBeNull()
  })

  test('区切り行の列数が見出しと合わなければ表ではない', () => {
    expect(parseMarkdownTable('| a | b |\n| --- |\n| 1 | 2 |')).toBeNull()
  })

  test('1 行だけなら表ではない', () => {
    expect(parseMarkdownTable('| a | b |')).toBeNull()
  })
})
