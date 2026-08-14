import { describe, expect, test } from 'vitest'
import {
  buildAxis,
  buildHealthSeries,
  formatMonthDay,
  HEALTH_GAP_DAYS,
  splitSegments,
  type HealthSourceRow,
} from './healthSeries'
import { MAX_HEALTH_DAYS } from './healthFence'

function rows(...memos: string[]): HealthSourceRow[] {
  return memos.map((memo, index) => ({ itemNo: String(4000 + index), memo }))
}

const AUGUST = rows(
  [
    '# 健康管理 2026-08',
    '',
    '- 2026-08-12 体重=66.8 体温=36.4',
    '- 2026-08-13 体重=66.6',
    '- 2026-08-14 体重=66.4 体温=36.5',
  ].join('\n'),
)

describe('buildHealthSeries', () => {
  test('記録が最多の項目を既定で選ぶ', () => {
    const series = buildHealthSeries(AUGUST, null, 30)
    expect(series.item).toBe('体重')
    expect(series.points.map((point) => point.value)).toEqual([66.8, 66.6, 66.4])
  })

  test('同数なら本文に先に出てきた項目を選ぶ', () => {
    const series = buildHealthSeries(rows('- 2026-08-14 体温=36.5 体重=66.4'), null, 30)
    expect(series.item).toBe('体温')
  })

  test('y= で選んだ項目を出す (綴りは指定どおり)', () => {
    const series = buildHealthSeries(AUGUST, '体温', 30)
    expect(series.item).toBe('体温')
    expect(series.points.map((point) => point.value)).toEqual([36.4, 36.5])
  })

  test('項目の照合は全角・大文字小文字を吸収する', () => {
    const series = buildHealthSeries(rows('- 2026-08-14 BMI=22.1'), 'ｂｍｉ', 30)
    expect(series.points).toHaveLength(1)
  })

  test('点は日付の昇順に並ぶ (ノートをまたいで集める)', () => {
    const series = buildHealthSeries(
      rows('- 2026-09-01 体重=66.0', '- 2026-08-31 体重=66.2'),
      null,
      30,
    )
    expect(series.points.map((point) => point.date)).toEqual([
      '2026-08-31',
      '2026-09-01',
    ])
  })

  test('同じ日付が 2 つあれば後に読んだほうを採る', () => {
    const series = buildHealthSeries(
      rows('- 2026-08-14 体重=66.4\n- 2026-08-14 体重=65.9'),
      null,
      30,
    )
    expect(series.points.map((point) => point.value)).toEqual([65.9])
  })

  test('期間は「いちばん新しい記録」から遡って切る', () => {
    const series = buildHealthSeries(
      rows(
        [
          '- 2026-07-01 体重=70.0',
          '- 2026-08-12 体重=66.8',
          '- 2026-08-14 体重=66.4',
        ].join('\n'),
      ),
      null,
      3,
    )
    // 2026-08-14 から 3 日ぶん = 08-12 以降。07-01 は期間の外
    expect(series.points.map((point) => point.date)).toEqual([
      '2026-08-12',
      '2026-08-14',
    ])
    expect(series.omitted).toBe(1)
  })

  test('期間内に収まっていれば切らない', () => {
    expect(buildHealthSeries(AUGUST, null, MAX_HEALTH_DAYS).omitted).toBe(0)
  })

  test('選ばなかった項目を otherItems に多い順で残す', () => {
    const series = buildHealthSeries(AUGUST, null, 30)
    expect(series.otherItems).toEqual(['体温'])
  })

  test('指定した項目の記録が無ければ空の系列を返す', () => {
    const series = buildHealthSeries(AUGUST, '血圧', 30)
    expect(series.item).toBe('血圧')
    expect(series.points).toEqual([])
    expect(series.otherItems).toEqual(['体重', '体温'])
  })

  test('記録が 1 つも無ければ項目名も空', () => {
    const series = buildHealthSeries(rows('# 健康管理\n\nまだ書いていない'), null, 30)
    expect(series.item).toBe('')
    expect(series.points).toEqual([])
    expect(series.otherItems).toEqual([])
    expect(series.axis).toBeNull()
  })

  test('単位は最初に見つかった非空のものを使う', () => {
    const series = buildHealthSeries(
      rows('- 2026-08-13 体重=66.6\n- 2026-08-14 体重=66.4kg'),
      null,
      30,
    )
    expect(series.unit).toBe('kg')
  })

  test('日番号は日付の差になる (グラフの横位置に使う)', () => {
    const series = buildHealthSeries(
      rows('- 2026-08-12 体重=66.8\n- 2026-08-14 体重=66.4'),
      null,
      30,
    )
    const [first, second] = series.points
    expect(second.day - first.day).toBe(2)
  })
})

describe('buildAxis', () => {
  test('縦軸を 0 から始めない (体重の差が潰れる)', () => {
    const axis = buildAxis(66.4, 66.8)
    expect(axis.lo).toBeGreaterThan(60)
    expect(axis.lo).toBeLessThanOrEqual(66.4)
    expect(axis.hi).toBeGreaterThanOrEqual(66.8)
  })

  test('目盛りは 3〜5 本', () => {
    for (const [min, max] of [
      [66.4, 66.8],
      [35.5, 37.2],
      [0, 8000],
      [-3, 12],
    ]) {
      const axis = buildAxis(min, max)
      expect(axis.ticks.length).toBeGreaterThanOrEqual(3)
      expect(axis.ticks.length).toBeLessThanOrEqual(5)
    }
  })

  test('目盛りはきりのよい数にする', () => {
    expect(buildAxis(66.4, 66.8).ticks).toEqual([66.2, 66.4, 66.6, 66.8, 67])
  })

  test('全部同じ値でも軸が潰れない', () => {
    const axis = buildAxis(66.4, 66.4)
    expect(axis.hi).toBeGreaterThan(axis.lo)
    expect(axis.lo).toBeLessThanOrEqual(66.4)
    expect(axis.hi).toBeGreaterThanOrEqual(66.4)
  })

  test('小数の桁は目盛りの刻みに合わせる', () => {
    expect(buildAxis(66.4, 66.8).decimals).toBe(1)
    expect(buildAxis(0, 8000).decimals).toBe(0)
  })
})

describe('splitSegments', () => {
  const point = (day: number) => ({ date: '2026-08-14', value: 1, day })

  test('間隔が空いていなければ 1 本の線になる', () => {
    expect(splitSegments([point(0), point(1), point(3)])).toHaveLength(1)
  })

  test('大きく空いた区間で線を切る', () => {
    const segments = splitSegments([
      point(0),
      point(1),
      point(1 + HEALTH_GAP_DAYS + 1),
    ])
    expect(segments).toHaveLength(2)
    expect(segments[1]).toHaveLength(1)
  })

  test('点が無ければ線も無い', () => {
    expect(splitSegments([])).toEqual([])
  })
})

describe('formatMonthDay', () => {
  test('月/日 に畳む', () => {
    expect(formatMonthDay('2026-08-14')).toBe('8/14')
    expect(formatMonthDay('2026-12-01')).toBe('12/1')
  })
})
