import { describe, expect, test } from 'vitest'
import { addMonths, eventsByDay, eventTimeLabel, isMonth, jstToday, monthCells, monthGridRange } from './monthLayout'

const ev = (title: string, start: string, end: string, allDay = false) => ({ itemId: title, title, start, end, allDay })

describe('monthGridRange', () => {
  test('2026-11 は日曜始まりで 5 週 (11/1 が日曜)', () => {
    expect(monthGridRange('2026-11')).toEqual({ first: '2026-11-01', end: '2026-12-06', weeks: 5 })
  })

  test('2026-02 は 4 週ちょうど (2/1 が日曜・2/28 が土曜)', () => {
    expect(monthGridRange('2026-02')).toEqual({ first: '2026-02-01', end: '2026-03-01', weeks: 4 })
  })

  test('2026-08 は 6 週 (8/1 が土曜・8/31 が月曜)', () => {
    expect(monthGridRange('2026-08')).toEqual({ first: '2026-07-26', end: '2026-09-06', weeks: 6 })
  })

  test('monthCells は週 × 7 日', () => {
    const cells = monthCells('2026-10')
    expect(cells.length % 7).toBe(0)
    expect(cells[0]).toBe('2026-09-27')
    expect(cells.at(-1)).toBe('2026-10-31')
  })
})

describe('月の計算', () => {
  test('addMonths は年をまたぐ', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })

  test('isMonth', () => {
    expect(isMonth('2026-11')).toBe(true)
    expect(isMonth('2026-13')).toBe(false)
    expect(isMonth('2026-1')).toBe(false)
    expect(isMonth('abcd-ef')).toBe(false)
  })

  test('jstToday は UTC の夜でも JST の翌日', () => {
    expect(jstToday(new Date('2026-11-04T15:30:00Z'))).toBe('2026-11-05')
  })
})

describe('eventsByDay', () => {
  const days = ['2026-11-04', '2026-11-05', '2026-11-06']

  test('終日を先に、その後は時刻順', () => {
    const map = eventsByDay(
      [
        ev('夕', '2026-11-05T09:00:00Z', '2026-11-05T10:00:00Z'),
        ev('朝', '2026-11-05T00:00:00Z', '2026-11-05T01:00:00Z'),
        ev('終日', '2026-11-04T15:00:00Z', '2026-11-05T15:00:00Z', true),
      ],
      days,
    )
    expect(map.get('2026-11-05')?.map((e) => e.title)).toEqual(['終日', '朝', '夕'])
    expect(map.get('2026-11-04')).toEqual([])
  })

  test('済みの予定は日の最後 (済みの中も終日・時刻順)', () => {
    const map = eventsByDay(
      [
        { ...ev('朝', '2026-11-05T00:00:00Z', '2026-11-05T01:00:00Z'), done: true },
        ev('夕', '2026-11-05T09:00:00Z', '2026-11-05T10:00:00Z'),
        { ...ev('終日', '2026-11-04T15:00:00Z', '2026-11-05T15:00:00Z', true), done: true },
        ev('昼', '2026-11-05T03:00:00Z', '2026-11-05T04:00:00Z'),
      ],
      days,
    )
    expect(map.get('2026-11-05')?.map((e) => e.title)).toEqual(['昼', '夕', '終日', '朝'])
  })

  test('複数日の予定は掛かる日すべてに置く (終わりの日は含まない)', () => {
    const map = eventsByDay([ev('旅行', '2026-11-03T15:00:00Z', '2026-11-05T15:00:00Z', true)], days)
    expect([...map].filter(([, list]) => list.length > 0).map(([d]) => d)).toEqual(['2026-11-04', '2026-11-05'])
  })

  test('eventTimeLabel は JST の時刻', () => {
    expect(eventTimeLabel(ev('a', '2026-11-05T01:00:00Z', '2026-11-05T02:00:00Z'))).toBe('10:00')
    expect(eventTimeLabel(ev('a', '2026-11-04T15:00:00Z', '2026-11-05T15:00:00Z', true))).toBeNull()
  })
})
