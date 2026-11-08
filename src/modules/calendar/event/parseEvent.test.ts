import { describe, expect, test } from 'vitest'
import { extractProps } from '@/lib/markdown/props'
import { isEventDone, parseEvent } from './parseEvent'

const parse = (line: string) => parseEvent(extractProps(`# t\n\n${line}\n`))

describe('parseEvent', () => {
  test('date だけなら終日', () => {
    expect(parse('date=2026-11-05')).toEqual({ date: '2026-11-05', start: null, end: null, until: null })
  })

  test('時刻を読み、1 桁の時を揃える', () => {
    expect(parse('date=2026-11-05 start=9:30 end=11:00')).toEqual({
      date: '2026-11-05',
      start: '09:30',
      end: '11:00',
      until: null,
    })
  })

  test('end を省けば null (使う側が +1 時間にする)', () => {
    expect(parse('date=2026-11-05 start=10:00')?.end).toBeNull()
  })

  test('終日に end だけ書いても無視する', () => {
    expect(parse('date=2026-11-05 end=11:00')).toEqual({ date: '2026-11-05', start: null, end: null, until: null })
  })

  test('until は複数日。date と同じなら null に畳む', () => {
    expect(parse('date=2026-11-05 until=2026-11-07')?.until).toBe('2026-11-07')
    expect(parse('date=2026-11-05 until=2026-11-05')?.until).toBeNull()
  })

  test('複数日なら end が start より前でもよい', () => {
    expect(parse('date=2026-11-05 until=2026-11-06 start=22:00 end=02:00')?.end).toBe('02:00')
  })

  test.each([
    ['date=来週'],
    ['date=2026-13-01'],
    ['date=2026-02-30'],
    ['date=2026-11-05 start=25:00'],
    ['date=2026-11-05 start=10:60'],
    ['date=2026-11-05 start=10:00 end=09:00'],
    ['date=2026-11-05 until=2026-11-04'],
    ['date=2026-11-05 until=あした'],
  ])('読めない値は予定にしない: %s', (line) => {
    expect(parse(line)).toBeNull()
  })

  test('date が無ければ予定ではない', () => {
    expect(parse('start=10:00')).toBeNull()
    expect(parseEvent([])).toBeNull()
  })
})

describe('isEventDone', () => {
  const props = (line: string) => extractProps(`# t\n\n${line}\n`)

  test('done= に値があれば済み (値は済ませた日)', () => {
    expect(isEventDone(props('date=2026-11-05 done=2026-11-08'))).toBe(true)
  })

  test('done= が無ければ未済', () => {
    expect(isEventDone(props('date=2026-11-05 start=10:00'))).toBe(false)
  })
})
