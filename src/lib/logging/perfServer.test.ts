import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { clearPerfLines, recentPerfLines } from './buffer'
import { reportServerLine, reportServerPerf, reportSlowQuery } from './perfServer'
import { setPerfLogEnabled } from './perfSwitch'

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  setPerfLogEnabled(false)
  clearPerfLines()
  vi.restoreAllMocks()
})

describe('reportServerPerf', () => {
  test('計測していなければ (perf が null) 何も積まず null', () => {
    expect(reportServerPerf('検索', [['q', '"a"']], null)).toBeNull()
    expect(recentPerfLines()).toEqual([])
  })

  test('サーバの行を積み、ブラウザへ渡す印を返す', () => {
    const marks = reportServerPerf(
      'ノート',
      [['id', 'abc']],
      { totalMs: 12, phases: { 読込: 3 } },
      'item-1',
    )
    expect(marks).toMatchObject({
      kind: 'ノート',
      itemId: 'item-1',
      fields: [['id', 'abc']],
      server: '12ms(読込=3)',
    })
    expect(recentPerfLines()[0].text).toBe('[計測] ノート/サーバ id=abc サーバ=12ms(読込=3)')
  })
})

test('reportServerLine は段階だけの行を積む', () => {
  reportServerLine('検索/フォルダー', [['タグ', 37]], { totalMs: 2, phases: { 集計: 1 } })
  expect(recentPerfLines()[0].text).toBe('[計測] 検索/フォルダー タグ=37 サーバ=2ms(集計=1)')
})

describe('reportSlowQuery', () => {
  test('閾値未満と計測停止中は積まない', () => {
    setPerfLogEnabled(true)
    reportSlowQuery({ duration: 10, query: 'SELECT 1' })
    setPerfLogEnabled(false)
    reportSlowQuery({ duration: 500, query: 'SELECT 1' })
    expect(recentPerfLines()).toEqual([])
  })

  test('遅い文は先頭 200 文字を 1 行に潰して積む (パラメータは載せない)', () => {
    setPerfLogEnabled(true)
    reportSlowQuery({ duration: 120, query: `SELECT *\n  FROM items ${'x'.repeat(300)}` })
    const [line] = recentPerfLines()
    expect(line.text).toMatch(/^\[計測\] 遅いSQL 時間=120ms 文="SELECT \* FROM items x+"$/)
    expect(line.text.length).toBeLessThan(260)
  })
})
