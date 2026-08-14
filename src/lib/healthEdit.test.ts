import { describe, expect, test } from 'vitest'
import {
  MAX_MEASURE_ITEM_LENGTH,
  MAX_MEASURE_UNIT_LENGTH,
  recordMeasurement,
} from './healthEdit'

const ENTRY = { date: '2026-08-14', item: '体重', values: [66.4], unit: '' }

function record(memo: string, entry = ENTRY): string {
  const next = recordMeasurement(memo, entry)
  if (next === null) {
    throw new Error('書けるはずが null')
  }
  return next
}

describe('recordMeasurement', () => {
  test('記録の無い本文には末尾に足す', () => {
    expect(record('# 健康管理 2026-08\n\n#健康管理\n')).toBe(
      '# 健康管理 2026-08\n\n#健康管理\n\n- 2026-08-14 体重=66.4\n',
    )
  })

  test('空の本文にも書ける', () => {
    expect(record('')).toBe('- 2026-08-14 体重=66.4\n')
  })

  test('同じ日の同じ項目は書き換える', () => {
    expect(record('- 2026-08-14 体重=65.9')).toBe('- 2026-08-14 体重=66.4')
  })

  test('同じ日の他の項目は壊さない', () => {
    expect(record('- 2026-08-14 体温=36.5 体重=65.9 メモ=あり')).toBe(
      '- 2026-08-14 体温=36.5 体重=66.4 メモ=あり',
    )
  })

  test('同じ日にまだ無い項目は行末に足す', () => {
    expect(record('- 2026-08-14 体温=36.5')).toBe(
      '- 2026-08-14 体温=36.5 体重=66.4',
    )
  })

  test('項目名の照合は全角・大文字小文字を吸収し、綴りは本文のまま残す', () => {
    // 直すのは値だけ。本文に書いた綴りを勝手に書き換えない
    expect(
      record('- 2026-08-14 ＢＭＩ=22.1', {
        date: '2026-08-14',
        item: 'bmi',
        values: [22.5],
        unit: '',
      }),
    ).toBe('- 2026-08-14 ＢＭＩ=22.5')
  })

  test('新しい日付は最後の記録の直後に入る (フェンスの前に潜り込まない)', () => {
    const memo = [
      '- 2026-08-12 体重=66.8',
      '- 2026-08-13 体重=66.6',
      '',
      '```health',
      '#健康管理',
      '```',
    ].join('\n')
    expect(record(memo)).toBe(
      [
        '- 2026-08-12 体重=66.8',
        '- 2026-08-13 体重=66.6',
        '- 2026-08-14 体重=66.4',
        '',
        '```health',
        '#健康管理',
        '```',
      ].join('\n'),
    )
  })

  test('箇条書きの書き方を引き継ぐ', () => {
    expect(record('* 2026-08-13 体重=66.6')).toBe(
      '* 2026-08-13 体重=66.6\n* 2026-08-14 体重=66.4',
    )
    expect(record('2026-08-13 体重=66.6')).toBe(
      '2026-08-13 体重=66.6\n2026-08-14 体重=66.4',
    )
  })

  test('単位を付けて書ける', () => {
    expect(
      record('- 2026-08-14 体重=65.9kg', { ...ENTRY, unit: 'kg' }),
    ).toBe('- 2026-08-14 体重=66.4kg')
  })

  test('同じ日付が 2 行あれば後のほうを直す (読み方と揃える)', () => {
    expect(record('- 2026-08-14 体重=65.9\n- 2026-08-14 体重=65.5')).toBe(
      '- 2026-08-14 体重=65.9\n- 2026-08-14 体重=66.4',
    )
  })

  test('同じ行に同じ項目が 2 つあれば後のほうを直す (グラフが読む値と揃える)', () => {
    // 前を直すと、保存は成功しているのにグラフが動かない
    // (何度押しても直らない形になる)
    expect(record('- 2026-08-14 体重=66.4 体重=70.0')).toBe(
      '- 2026-08-14 体重=66.4 体重=66.4',
    )
  })

  test('字下げされたフェンスの中の日付も書き換えない', () => {
    const memo = [
      '1. 記録の書き方',
      '',
      '    ```text',
      '    - 2026-08-14 体重=99.9',
      '    ```',
    ].join('\n')
    // 説明文には触れず、本文の末尾に新しい行として足す
    expect(record(memo)).toBe(`${memo}\n\n- 2026-08-14 体重=66.4`)
  })

  test('コードフェンスの中の日付は書き換えない', () => {
    const memo = ['```text', '- 2026-08-14 体重=99.9', '```'].join('\n')
    expect(record(memo)).toBe(
      ['```text', '- 2026-08-14 体重=99.9', '```', '', '- 2026-08-14 体重=66.4'].join(
        '\n',
      ),
    )
  })

  test('改行コードを保つ (CRLF のノートを壊さない)', () => {
    expect(record('- 2026-08-13 体重=66.6\r\n')).toBe(
      '- 2026-08-13 体重=66.6\r\n- 2026-08-14 体重=66.4\r\n',
    )
  })

  test('本文の書き換えは 1 か所だけ (同じ値の他の行を巻き込まない)', () => {
    const memo = ['- 2026-08-12 体重=65.9', '- 2026-08-14 体重=65.9'].join('\n')
    expect(record(memo)).toBe(
      ['- 2026-08-12 体重=65.9', '- 2026-08-14 体重=66.4'].join('\n'),
    )
  })

  test('対の値 (血圧) は / でつないで書く', () => {
    const entry = { date: '2026-08-14', item: '血圧', values: [118, 76], unit: 'mmHg' }
    expect(record('', entry)).toBe('- 2026-08-14 血圧=118/76mmHg\n')
    expect(record('- 2026-08-14 血圧=120/78mmHg', entry)).toBe(
      '- 2026-08-14 血圧=118/76mmHg',
    )
  })

  test('対の値を 1 つの値で上書きしない (拡張期が黙って消える)', () => {
    expect(
      recordMeasurement('- 2026-08-14 血圧=118/76mmHg', {
        date: '2026-08-14',
        item: '血圧',
        values: [120],
        unit: 'mmHg',
      }),
    ).toBeNull()
  })

  test('値を増やす向きは通る', () => {
    expect(
      record('- 2026-08-14 血圧=118mmHg', {
        date: '2026-08-14',
        item: '血圧',
        values: [120, 78],
        unit: 'mmHg',
      }),
    ).toBe('- 2026-08-14 血圧=120/78mmHg')
  })

  test('値が空なら書かない', () => {
    expect(recordMeasurement('', { ...ENTRY, values: [] })).toBeNull()
  })

  test('値が多すぎれば書かない', () => {
    expect(
      recordMeasurement('', { ...ENTRY, values: [118, 76, 62, 50] }),
    ).toBeNull()
  })

  test('読み直せない書き方は書かずに断る', () => {
    // 書いた結果を自分で読み直せない = ノートに壊れた行が残るということ
    expect(recordMeasurement('', { ...ENTRY, item: '体 重' })).toBeNull()
    expect(recordMeasurement('', { ...ENTRY, item: '体=重' })).toBeNull()
    expect(recordMeasurement('', { ...ENTRY, item: '' })).toBeNull()
    expect(recordMeasurement('', { ...ENTRY, values: [Number.NaN] })).toBeNull()
    expect(recordMeasurement('', { ...ENTRY, values: [Infinity] })).toBeNull()
    expect(recordMeasurement('', { ...ENTRY, values: [1e21] })).toBeNull()
    expect(recordMeasurement('', { ...ENTRY, unit: 'k g' })).toBeNull()
    expect(recordMeasurement('', { ...ENTRY, unit: 'm2' })).toBeNull()
  })

  test('長すぎる項目名・単位は書かない (口は誰でも叩ける)', () => {
    const item = 'あ'.repeat(MAX_MEASURE_ITEM_LENGTH)
    expect(recordMeasurement('', { ...ENTRY, item })).not.toBeNull()
    expect(recordMeasurement('', { ...ENTRY, item: `${item}あ` })).toBeNull()

    const unit = 'あ'.repeat(MAX_MEASURE_UNIT_LENGTH)
    expect(recordMeasurement('', { ...ENTRY, unit })).not.toBeNull()
    expect(recordMeasurement('', { ...ENTRY, unit: `${unit}あ` })).toBeNull()
  })

  test('日付が暦になければ書かない', () => {
    expect(recordMeasurement('', { ...ENTRY, date: '2026-02-30' })).toBeNull()
    expect(recordMeasurement('', { ...ENTRY, date: '2026-8-14' })).toBeNull()
    expect(recordMeasurement('', { ...ENTRY, date: 'きょう' })).toBeNull()
  })
})
