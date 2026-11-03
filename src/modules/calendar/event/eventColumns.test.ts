import { describe, expect, test } from 'vitest'
import { eventColumnsOf } from './eventColumns'
import { addDays, eventSpan, jstParts } from './eventTime'

describe('eventColumnsOf', () => {
  test('終日は JST の 0 時から翌 0 時 (半開区間)', () => {
    const c = eventColumnsOf('# 歯医者\n\n#予定\ndate=2026-11-05\n')
    expect(c.eventStart?.toISOString()).toBe('2026-11-04T15:00:00.000Z')
    expect(c.eventEnd?.toISOString()).toBe('2026-11-05T15:00:00.000Z')
    expect(c.eventRepeat).toBeNull()
  })

  test('時刻つき。end を省けば 1 時間', () => {
    const c = eventColumnsOf('date=2026-11-05 start=10:00')
    expect(c.eventStart?.toISOString()).toBe('2026-11-05T01:00:00.000Z')
    expect(c.eventEnd?.toISOString()).toBe('2026-11-05T02:00:00.000Z')
  })

  test('複数日の終日は最終日の翌 0 時まで', () => {
    const c = eventColumnsOf('date=2026-11-30 until=2026-12-02')
    expect(c.eventEnd?.toISOString()).toBe('2026-12-02T15:00:00.000Z')
  })

  test('予定でない本文は 3 列とも null', () => {
    expect(eventColumnsOf('# メモ\n\nhFE=208\n')).toEqual({ eventStart: null, eventEnd: null, eventRepeat: null })
    expect(eventColumnsOf('date=来週')).toEqual({ eventStart: null, eventEnd: null, eventRepeat: null })
  })

  test('コードフェンスの中の date= は読まない', () => {
    expect(eventColumnsOf('```\ndate=2026-11-05\n```\n').eventStart).toBeNull()
  })
})

describe('eventTime', () => {
  test('addDays は月・年をまたぐ', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
  })

  test('jstParts は JST の暦日と時刻を返す', () => {
    expect(jstParts(new Date('2026-11-04T15:30:00Z'))).toEqual({ date: '2026-11-05', time: '00:30' })
  })

  test('eventSpan の allDay', () => {
    expect(eventSpan({ date: '2026-11-05', start: null, end: null, until: null }).allDay).toBe(true)
    expect(eventSpan({ date: '2026-11-05', start: '10:00', end: null, until: null }).allDay).toBe(false)
  })
})
