import { describe, expect, test } from 'vitest'
import { DEFAULT_CALENDAR_PREFS, parseCalendarPrefs, readableTextColor, validateCalendarPrefs } from './calendarPrefs'

describe('parseCalendarPrefs (保存値を畳む)', () => {
  test('壊れた・無い値は既定', () => {
    expect(parseCalendarPrefs(null)).toEqual(DEFAULT_CALENDAR_PREFS)
    expect(parseCalendarPrefs('{')).toEqual(DEFAULT_CALENDAR_PREFS)
  })

  test('読める所だけ拾い、読めない所は既定に寄せる', () => {
    const raw = JSON.stringify({ dateSize: 'lg', colors: { high: '#112233', normal: 'red', low: '#ABCDEF' } })
    expect(parseCalendarPrefs(raw)).toEqual({
      dateSize: 'lg',
      colors: { high: '#112233', normal: DEFAULT_CALENDAR_PREFS.colors.normal, low: '#abcdef' },
    })
  })
})

describe('validateCalendarPrefs (API の入口は畳まず断る)', () => {
  test('正しい形だけ通す', () => {
    const ok = { dateSize: 'sm', colors: { high: '#ff0000', normal: '#00ff00', low: '#0000ff' } }
    expect(validateCalendarPrefs(ok)).toEqual(ok)
  })

  test('知らない大きさ・色の形・欠けは null', () => {
    expect(validateCalendarPrefs({ dateSize: 'xl', colors: DEFAULT_CALENDAR_PREFS.colors })).toBeNull()
    expect(validateCalendarPrefs({ dateSize: 'md', colors: { ...DEFAULT_CALENDAR_PREFS.colors, low: 'url(x)' } })).toBeNull()
    expect(validateCalendarPrefs({ dateSize: 'md' })).toBeNull()
  })
})

describe('readableTextColor', () => {
  test('明るい地には濃い文字、暗い地には白', () => {
    expect(readableTextColor('#fecaca')).toBe('#1f2937')
    expect(readableTextColor('#1e3a8a')).toBe('#ffffff')
    expect(readableTextColor('#b91c1c')).toBe('#ffffff')
    // 鮮やかな赤は濃い文字のほうが対比が大きい (WCAG の相対輝度)
    expect(readableTextColor('#f43f5e')).toBe('#1f2937')
  })
})
