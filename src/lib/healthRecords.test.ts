import { describe, expect, test } from 'vitest'
import { healthDataLines, parseMeasureToken } from './healthRecords'

function measures(memo: string) {
  return healthDataLines(memo).flatMap((line) => line.measures)
}

describe('healthDataLines', () => {
  test('日付で始まる行を記録として読む', () => {
    expect(healthDataLines('- 2026-08-14 体重=66.4')).toEqual([
      {
        line: 1,
        date: '2026-08-14',
        measures: [{ label: '体重', values: [66.4], unit: '' }],
      },
    ])
  })

  test('箇条書き記号は無くてもよい', () => {
    expect(measures('2026-08-14 体重=66.4')).toEqual([
      { label: '体重', values: [66.4], unit: '' },
    ])
    expect(measures('* 2026-08-14 体重=66.4')).toHaveLength(1)
    expect(measures('  + 2026-08-14 体重=66.4')).toHaveLength(1)
  })

  test('1 行に複数の項目を書ける', () => {
    expect(measures('- 2026-08-14 体重=66.4 体温=36.5')).toEqual([
      { label: '体重', values: [66.4], unit: '' },
      { label: '体温', values: [36.5], unit: '' },
    ])
  })

  test('単位を付けて書ける', () => {
    expect(measures('- 2026-08-14 体重=66.4kg 体温=36.5℃')).toEqual([
      { label: '体重', values: [66.4], unit: 'kg' },
      { label: '体温', values: [36.5], unit: '℃' },
    ])
  })

  test('全角の数字・全角空白でも読む', () => {
    expect(measures('- 2026-08-14　体重＝６６.４')).toEqual([
      { label: '体重', values: [66.4], unit: '' },
    ])
  })

  test('行番号は 1 始まりで数える', () => {
    const lines = healthDataLines('# 健康管理\n\n- 2026-08-14 体重=66.4')
    expect(lines.map((line) => line.line)).toEqual([3])
  })

  test('日付で始まらない行は読まない', () => {
    expect(measures('体重=66.4')).toEqual([])
    expect(measures('2026-08-14の記録 体重=66.4')).toEqual([])
    expect(measures('きのう 2026-08-14 体重=66.4')).toEqual([])
  })

  test('暦にない日付は読まない', () => {
    expect(measures('- 2026-13-01 体重=66.4')).toEqual([])
    expect(measures('- 2026-02-30 体重=66.4')).toEqual([])
  })

  test('コードフェンスの中は読まない', () => {
    const memo = [
      '```text',
      '- 2026-08-14 体重=99.9',
      '```',
      '- 2026-08-15 体重=66.4',
    ].join('\n')
    expect(measures(memo)).toEqual([{ label: '体重', values: [66.4], unit: '' }])
  })

  test('閉じていないフェンスの中も読まない (書きかけの本文)', () => {
    const memo = ['```text', '- 2026-08-14 体重=99.9'].join('\n')
    expect(measures(memo)).toEqual([])
  })

  test('字下げされたフェンスの中も読まない (リストの中の用例)', () => {
    // 番号付きリストの中では 4 字下げが正しい書き方。記号を自分で数える
    // 走査だとここを見落とし、記法の説明文が記録として読まれる
    const memo = [
      '1. 記録の書き方',
      '',
      '    ```text',
      '    - 2026-08-14 体重=99.9',
      '    ```',
    ].join('\n')
    expect(measures(memo)).toEqual([])
  })

  test('字下げコードブロック (フェンス無し) も読まない', () => {
    expect(measures('説明\n\n    - 2026-08-14 体重=99.9')).toEqual([])
  })

  test('長いフェンスの中の短いフェンスは閉じ扱いにしない', () => {
    const memo = [
      '````markdown',
      '```health',
      '#健康管理',
      '```',
      '- 2026-08-14 体重=99.9',
      '````',
    ].join('\n')
    expect(measures(memo)).toEqual([])
  })

  test('控えを渡すと同じ本文を 2 度解析しない', () => {
    const cache = new Map()
    const memo = '- 2026-08-14 体重=66.4'
    const first = healthDataLines(memo, cache)
    expect(cache.size).toBe(1)
    // 2 度目は控えをそのまま返す (同じ配列)
    expect(healthDataLines(memo, cache)).toBe(first)
  })

  test('日付だけの行は項目なしで残る', () => {
    // 記録欄が「その日の行」を探せるように、項目が無くても行としては返す
    expect(healthDataLines('- 2026-08-14')).toEqual([
      { line: 1, date: '2026-08-14', measures: [] },
    ])
  })

  test('キー=値 でないトークンは読み飛ばす', () => {
    expect(measures('- 2026-08-14 体重=66.4 まあまあ')).toEqual([
      { label: '体重', values: [66.4], unit: '' },
    ])
  })
})

describe('parseMeasureToken', () => {
  test('/ 区切りの対の値を 1 つの項目として読む (血圧。計画 §9)', () => {
    expect(parseMeasureToken('血圧=118/76')).toEqual({
      label: '血圧',
      values: [118, 76],
      unit: '',
    })
    expect(parseMeasureToken('血圧=118/76mmHg')).toEqual({
      label: '血圧',
      values: [118, 76],
      unit: 'mmHg',
    })
  })

  test('全角のスラッシュ・数字でも読む', () => {
    expect(parseMeasureToken('血圧＝１１８／７６')).toEqual({
      label: '血圧',
      values: [118, 76],
      unit: '',
    })
  })

  test('単位の中の / は区切りにしない (mg/dL・回/分)', () => {
    // ここを区切りとして読むと、既に書いてある記録が黙って全部消える
    expect(parseMeasureToken('血糖=95mg/dL')).toEqual({
      label: '血糖',
      values: [95],
      unit: 'mg/dL',
    })
    expect(parseMeasureToken('脈拍=62回/分')).toEqual({
      label: '脈拍',
      values: [62],
      unit: '回/分',
    })
    expect(parseMeasureToken('速度=10km/h')?.unit).toBe('km/h')
  })

  test('値は 3 つまで', () => {
    expect(parseMeasureToken('血圧=118/76/62')?.values).toEqual([118, 76, 62])
    expect(parseMeasureToken('血圧=118/76/62/50')).toBeNull()
  })

  test('数値として読めない値は捨てる', () => {
    // 数値に畳めない値を黙って線に載せるとグラフが嘘になる
    expect(parseMeasureToken('体重=120～200')).toBeNull()
    expect(parseMeasureToken('血圧=118/')).toBeNull()
    expect(parseMeasureToken('血圧=/76')).toBeNull()
    expect(parseMeasureToken('血圧=118//76')).toBeNull()
    expect(parseMeasureToken('血圧=118/上76')).toBeNull()
    expect(parseMeasureToken('服薬=済')).toBeNull()
    expect(parseMeasureToken('体重=')).toBeNull()
    expect(parseMeasureToken('=66.4')).toBeNull()
    expect(parseMeasureToken('体重')).toBeNull()
  })

  test('符号付き・整数の値も読む', () => {
    expect(parseMeasureToken('気温=-1.5')).toEqual({
      label: '気温',
      values: [-1.5],
      unit: '',
    })
    expect(parseMeasureToken('歩数=8000歩')).toEqual({
      label: '歩数',
      values: [8000],
      unit: '歩',
    })
  })

  test('項目名は打ったまま持つ', () => {
    expect(parseMeasureToken('ＢＭＩ=22.1')?.label).toBe('ＢＭＩ')
  })
})
