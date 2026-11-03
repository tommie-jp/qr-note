import { describe, expect, test } from 'vitest'
import { calendarEntryHref, eventNoteHref, withCalendarMonth } from './calendarUrl'

describe('calendarUrl', () => {
  test('withCalendarMonth はパスを保ったまま cal だけ替える', () => {
    const url = new URL('http://h/item/abc?q=%23予定&cal=2026-11&tab=event')
    expect(withCalendarMonth(url, '2026-12')).toBe('/item/abc?q=%23%E4%BA%88%E5%AE%9A&cal=2026-12&tab=event')
    expect(withCalendarMonth(new URL('http://h/?q=a&cal=2026-11'), null)).toBe('/?q=a')
  })

  test('calendarEntryHref は空の検索語に #予定 を補う', () => {
    expect(calendarEntryHref(' ', '2026-11')).toBe('/?q=%23%E4%BA%88%E5%AE%9A&cal=2026-11')
    expect(calendarEntryHref('#仕事', '2026-11')).toBe('/?q=%23%E4%BB%95%E4%BA%8B&cal=2026-11')
  })

  test('eventNoteHref は q・cal・tab・date を載せる', () => {
    expect(eventNoteHref('id1', '#予定', '2026-11', '2026-11-05')).toBe(
      '/item/id1?q=%23%E4%BA%88%E5%AE%9A&cal=2026-11&tab=event&date=2026-11-05',
    )
  })
})
