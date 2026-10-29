import { describe, expect, test } from 'vitest'
import {
  formatPerfLine,
  formatPhaseSummary,
  formatServerTiming,
  parsePerfLine,
  perfKB,
  perfMB,
  perfMs,
  perfQuery,
} from './perfLine'

describe('formatPerfLine', () => {
  test('種別のあとに key=値 を渡した順に並べる', () => {
    expect(
      formatPerfLine('検索', [
        ['q', '"抵抗"'],
        ['件数', '21/48'],
        ['全体', perfMs(624.4)],
      ]),
    ).toBe('[計測] 検索 q="抵抗" 件数=21/48 全体=624ms')
  })

  test('null・undefined・空文字の項目は出さない', () => {
    expect(formatPerfLine('同期', [['a', null], ['b', undefined], ['c', ''], ['d', 0]])).toBe(
      '[計測] 同期 d=0',
    )
  })

  test('数は整数に丸める', () => {
    expect(formatPerfLine('x', [['n', 12.6]])).toBe('[計測] x n=13')
  })
})

describe('値の整形', () => {
  test('立っていない時間は 0ms ではなく未了と書く', () => {
    expect(perfMs(null)).toBe('未了')
    expect(perfMs(undefined)).toBe('未了')
    expect(perfMs(Number.NaN)).toBe('未了')
    expect(perfMs(0)).toBe('0ms')
  })

  test('量は KB・MB の整数、測れなければ ?', () => {
    expect(perfKB(1536)).toBe('2KB')
    expect(perfKB(null)).toBe('?')
    expect(perfMB(312 * 1024 * 1024)).toBe('312MB')
  })

  test('検索語は 20 文字で切り、引用符と空白を潰す', () => {
    expect(perfQuery('抵抗')).toBe('"抵抗"')
    expect(perfQuery('a"b\nc d')).toBe('"a_b_c_d"')
    expect(perfQuery('あ'.repeat(25))).toBe(`"${'あ'.repeat(20)}…"`)
  })
})

describe('formatPhaseSummary', () => {
  test('全体と段階を 1 項目に畳む', () => {
    expect(formatPhaseSummary({ totalMs: 23.4, phases: { 検索: 3, 特性: 0 } })).toBe(
      '23ms(検索=3 特性=0)',
    )
  })

  test('段階が無ければ全体だけ', () => {
    expect(formatPhaseSummary({ totalMs: 5, phases: {} })).toBe('5ms')
  })
})

describe('formatServerTiming', () => {
  test('ASCII の名前だけを Server-Timing の形にする', () => {
    expect(formatServerTiming({ db: 40.2, json: 90, 検索: 3 })).toBe('db;dur=40, json;dur=90')
  })
})

describe('parsePerfLine', () => {
  test('formatPerfLine の行を読み戻す (括弧の中の空白で切らない)', () => {
    const text = formatPerfLine('検索', [
      ['q', perfQuery('抵抗 器')],
      ['全体', perfMs(624)],
      ['サーバ', '23ms(検索=3 特性=0)'],
    ])

    expect(parsePerfLine(text)).toEqual({
      kind: '検索',
      fields: { q: '"抵抗_器"', 全体: '624ms', サーバ: '23ms(検索=3 特性=0)' },
    })
  })

  test('計測行でなければ null', () => {
    expect(parsePerfLine('[起動] 全体=1ms')).toBeNull()
    expect(parsePerfLine('')).toBeNull()
  })
})
