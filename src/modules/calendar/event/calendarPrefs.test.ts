import { describe, expect, test } from 'vitest'
import {
  DEFAULT_CALENDAR_PREFS,
  layoutOf,
  parseCalendarLayout,
  eventTextColor,
  parseCalendarPrefs,
  readableTextColor,
  validateCalendarPrefs,
} from './calendarPrefs'

describe('parseCalendarPrefs (保存値を畳む)', () => {
  test('壊れた・無い値は既定', () => {
    expect(parseCalendarPrefs(null)).toEqual(DEFAULT_CALENDAR_PREFS)
    expect(parseCalendarPrefs('{')).toEqual(DEFAULT_CALENDAR_PREFS)
  })

  test('読める所だけ拾い、読めない所は既定に寄せる', () => {
    const raw = JSON.stringify({ dateSize: 'lg', colors: { high: '#112233', normal: 'red', low: '#ABCDEF' } })
    expect(parseCalendarPrefs(raw)).toEqual({
      dateSize: 'lg',
      // 前の版の保存値 (予定の大きさを持たない) は中
      eventSize: 'md',
      sidePadding: 'md',
      eventsPerDay: 5,
      colors: { high: '#112233', normal: DEFAULT_CALENDAR_PREFS.colors.normal, low: '#abcdef' },
      // 前の版の保存値 (文字色を持たない) は自動
      textColors: { high: 'auto', normal: 'auto', low: 'auto' },
    })
  })
})

describe('validateCalendarPrefs (API の入口は畳まず断る)', () => {
  test('正しい形だけ通す', () => {
    const ok = {
      dateSize: 'sm',
      eventSize: 'lg',
      sidePadding: 'none',
      eventsPerDay: 20,
      colors: { high: '#ff0000', normal: '#00ff00', low: '#0000ff' },
      textColors: { high: '#ffffff', normal: 'auto', low: '#1f2937' },
    }
    expect(validateCalendarPrefs(ok)).toEqual(ok)
  })

  test('知らない大きさ・色の形・欠けは null', () => {
    expect(validateCalendarPrefs({ dateSize: 'xl', colors: DEFAULT_CALENDAR_PREFS.colors })).toBeNull()
    expect(validateCalendarPrefs({ dateSize: 'md', colors: { ...DEFAULT_CALENDAR_PREFS.colors, low: 'url(x)' } })).toBeNull()
    expect(validateCalendarPrefs({ dateSize: 'md' })).toBeNull()
    expect(validateCalendarPrefs({ dateSize: 'xl', colors: DEFAULT_CALENDAR_PREFS.colors })).toBeNull()
    expect(
      validateCalendarPrefs({ ...DEFAULT_CALENDAR_PREFS, textColors: { ...DEFAULT_CALENDAR_PREFS.textColors, high: 'red' } }),
    ).toBeNull()
  })
})

describe('予定の文字の大きさ (eventSize)', () => {
  test('保存値の読めない大きさは中に寄せる', () => {
    expect(parseCalendarPrefs(JSON.stringify({ eventSize: 'xl' })).eventSize).toBe('md')
    expect(parseCalendarPrefs(JSON.stringify({ eventSize: 'sm' })).eventSize).toBe('sm')
  })

  test('PUT は省略なら中、知らない大きさは断る', () => {
    expect(validateCalendarPrefs({ ...DEFAULT_CALENDAR_PREFS, eventSize: undefined })?.eventSize).toBe('md')
    expect(validateCalendarPrefs({ ...DEFAULT_CALENDAR_PREFS, eventSize: 'xl' })).toBeNull()
  })
})

describe('左右の余白 (sidePadding) と 1 日の予定数 (eventsPerDay)', () => {
  test('保存値の読めない値は既定 (中・5) に寄せる', () => {
    expect(parseCalendarPrefs(JSON.stringify({ sidePadding: 'xl', eventsPerDay: 2 }))).toMatchObject({
      sidePadding: 'md',
      eventsPerDay: 5,
    })
    expect(parseCalendarPrefs(JSON.stringify({ sidePadding: 'sm', eventsPerDay: 12 }))).toMatchObject({
      sidePadding: 'sm',
      eventsPerDay: 12,
    })
  })

  test('PUT は省略なら既定、範囲外・小数・知らない余白は断る', () => {
    const base = { ...DEFAULT_CALENDAR_PREFS, sidePadding: undefined, eventsPerDay: undefined }
    expect(validateCalendarPrefs(base)).toMatchObject({ sidePadding: 'md', eventsPerDay: 5 })
    expect(validateCalendarPrefs({ ...DEFAULT_CALENDAR_PREFS, eventsPerDay: 3 })?.eventsPerDay).toBe(3)
    expect(validateCalendarPrefs({ ...DEFAULT_CALENDAR_PREFS, eventsPerDay: 2 })).toBeNull()
    expect(validateCalendarPrefs({ ...DEFAULT_CALENDAR_PREFS, eventsPerDay: 21 })).toBeNull()
    expect(validateCalendarPrefs({ ...DEFAULT_CALENDAR_PREFS, eventsPerDay: 4.5 })).toBeNull()
    expect(validateCalendarPrefs({ ...DEFAULT_CALENDAR_PREFS, sidePadding: 'lg' })).toBeNull()
  })
})

describe('端末ごとの表示 (layout、docs/126 §1-20)', () => {
  test('layoutOf は大きさ・余白・予定数だけを抜く (色は含めない)', () => {
    expect(layoutOf(DEFAULT_CALENDAR_PREFS)).toEqual({ dateSize: 'md', eventSize: 'md', sidePadding: 'md', eventsPerDay: 5 })
  })

  test('parseCalendarLayout は前の版の写し (色を含む全体) からも読め、読めない所は既定', () => {
    const old = JSON.stringify({ ...DEFAULT_CALENDAR_PREFS, dateSize: 'lg', eventsPerDay: 9 })
    expect(parseCalendarLayout(old)).toEqual({ dateSize: 'lg', eventSize: 'md', sidePadding: 'md', eventsPerDay: 9 })
    expect(parseCalendarLayout(null)).toEqual(layoutOf(DEFAULT_CALENDAR_PREFS))
  })

  test('PUT は色だけ (大きさ無し) でも通る', () => {
    const { colors, textColors } = DEFAULT_CALENDAR_PREFS
    expect(validateCalendarPrefs({ colors, textColors })).toEqual(DEFAULT_CALENDAR_PREFS)
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

describe('eventTextColor', () => {
  test('自動なら地の明るさから、色を選んでいればその色', () => {
    expect(eventTextColor(DEFAULT_CALENDAR_PREFS, 'high')).toBe('#1f2937')
    const prefs = { ...DEFAULT_CALENDAR_PREFS, textColors: { ...DEFAULT_CALENDAR_PREFS.textColors, high: '#b91c1c' } }
    expect(eventTextColor(prefs, 'high')).toBe('#b91c1c')
  })
})
