// カレンダーの表示の設定 (docs/126 §1-12・§1-18・§1-19)。日付と予定の文字の大きさ、
// 月の左右の余白、1 日に出す予定の数、優先度ごとの色。
// DB にも React にも触らない純関数で、サーバ (検査・既定) と端末 (描く) が共有する。
//
// 保存は user_settings の 1 行 (key = calendar-prefs、値は JSON)。端末をまたいで効く
import type { EventPriority } from './parseEvent'

export type DateSize = 'sm' | 'md' | 'lg'
// 月のマス目の左右の余白 (§1-19)。none 0 / sm 8px / md 16px (画面の余白と同じ)
export type SidePadding = 'none' | 'sm' | 'md'

// 文字色の「自動」(地の明るさから白か濃い灰を選ぶ)
export const AUTO_TEXT = 'auto'

export interface CalendarPrefs {
  dateSize: DateSize
  // マス目の予定の文字の大きさ (§1-18)。段階は日付と同じ小・中・大
  eventSize: DateSize
  sidePadding: SidePadding
  // 1 マスに出す行 (祝日名 + 予定) の数 (§1-19)。マスの高さはこの行数で固定する
  eventsPerDay: number
  // 地の色。#rrggbb (小文字)
  colors: Record<EventPriority, string>
  // 文字の色。#rrggbb (小文字) か 'auto'
  textColors: Record<EventPriority, string>
}

export const CALENDAR_PREFS_SETTING_KEY = 'calendar-prefs'

export const SIDE_PADDINGS: readonly { value: SidePadding; label: string }[] = [
  { value: 'none', label: '0' },
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
]

export const MIN_EVENTS_PER_DAY = 3
export const MAX_EVENTS_PER_DAY = 20

export const DATE_SIZES: readonly { value: DateSize; label: string }[] = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
]

// 既定は §1-11 の色 (Tailwind の red/orange/green-200)
export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = {
  dateSize: 'md',
  eventSize: 'md',
  sidePadding: 'md',
  eventsPerDay: 5,
  colors: { high: '#fecaca', normal: '#fed7aa', low: '#bbf7d0' },
  textColors: { high: AUTO_TEXT, normal: AUTO_TEXT, low: AUTO_TEXT },
}

// 文字色のテンプレート (濃い灰・白・濃い赤・濃い橙・濃い緑・濃い青・灰)
export const TEXT_TEMPLATE_COLORS: readonly string[] = [
  '#1f2937',
  '#ffffff',
  '#b91c1c',
  '#c2410c',
  '#15803d',
  '#1d4ed8',
  '#6b7280',
]

// メニューに並べるテンプレート色 (白 + 薄い 9 色 + SaiSuke2 風の濃い 5 色)
export const TEMPLATE_COLORS: readonly string[] = [
  '#ffffff',
  '#fecaca',
  '#fed7aa',
  '#fef08a',
  '#bbf7d0',
  '#99f6e4',
  '#bfdbfe',
  '#e9d5ff',
  '#fbcfe8',
  '#e5e7eb',
  '#f43f5e',
  '#f97316',
  '#22c55e',
  '#3b82f6',
  '#6b7280',
]

const HEX = /^#[0-9a-f]{6}$/i
const PRIORITIES: readonly EventPriority[] = ['high', 'normal', 'low']

const isDateSize = (value: unknown): value is DateSize => DATE_SIZES.some((size) => size.value === value)
const isSidePadding = (value: unknown): value is SidePadding => SIDE_PADDINGS.some((p) => p.value === value)
const isEventsPerDay = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= MIN_EVENTS_PER_DAY && value <= MAX_EVENTS_PER_DAY
const isHex = (value: unknown): value is string => typeof value === 'string' && HEX.test(value)

const isTextColor = (value: unknown): value is string => value === AUTO_TEXT || isHex(value)
const lower = (record: Record<string, unknown>): Record<EventPriority, string> => ({
  high: String(record.high).toLowerCase(),
  normal: String(record.normal).toLowerCase(),
  low: String(record.low).toLowerCase(),
})

// API の入口。知らない値は畳まず断る (送り手が保存できたと思い込まないように)。
// 文字色 (textColors)・予定の大きさ (eventSize)・余白 (sidePadding)・予定数 (eventsPerDay) は
// 省略してよい (前の版の画面から来る PUT。既定と見る)
export function validateCalendarPrefs(value: unknown): CalendarPrefs | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { dateSize, eventSize, sidePadding, eventsPerDay, colors, textColors } = value as {
    dateSize?: unknown
    eventSize?: unknown
    sidePadding?: unknown
    eventsPerDay?: unknown
    colors?: unknown
    textColors?: unknown
  }
  if (!isDateSize(dateSize) || typeof colors !== 'object' || colors === null) {
    return null
  }
  if (
    (eventSize !== undefined && !isDateSize(eventSize)) ||
    (sidePadding !== undefined && !isSidePadding(sidePadding)) ||
    (eventsPerDay !== undefined && !isEventsPerDay(eventsPerDay))
  ) {
    return null
  }
  const layout = {
    eventSize: eventSize ?? DEFAULT_CALENDAR_PREFS.eventSize,
    sidePadding: sidePadding ?? DEFAULT_CALENDAR_PREFS.sidePadding,
    eventsPerDay: eventsPerDay ?? DEFAULT_CALENDAR_PREFS.eventsPerDay,
  }
  const c = colors as Record<string, unknown>
  if (!PRIORITIES.every((p) => isHex(c[p]))) {
    return null
  }
  if (textColors === undefined) {
    return { dateSize, ...layout, colors: lower(c), textColors: DEFAULT_CALENDAR_PREFS.textColors }
  }
  if (typeof textColors !== 'object' || textColors === null) {
    return null
  }
  const t = textColors as Record<string, unknown>
  if (!PRIORITIES.every((p) => isTextColor(t[p]))) {
    return null
  }
  return { dateSize, ...layout, colors: lower(c), textColors: lower(t) }
}

// 保存値 (JSON 文字列) を畳む。読めない所は既定に寄せる (表示の設定なので
// 壊れていても既定で描けば困らない)
export function parseCalendarPrefs(raw: string | null): CalendarPrefs {
  let value: unknown = null
  try {
    value = raw === null ? null : JSON.parse(raw)
  } catch {
    return DEFAULT_CALENDAR_PREFS
  }
  const v = (typeof value === 'object' && value !== null ? value : {}) as {
    dateSize?: unknown
    eventSize?: unknown
    sidePadding?: unknown
    eventsPerDay?: unknown
    colors?: unknown
    textColors?: unknown
  }
  const record = (x: unknown) => (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>
  const c = record(v.colors)
  const t = record(v.textColors)
  const pick = (from: Record<string, unknown>, ok: (x: unknown) => x is string, fallback: Record<EventPriority, string>) =>
    Object.fromEntries(PRIORITIES.map((p) => [p, ok(from[p]) ? String(from[p]).toLowerCase() : fallback[p]])) as Record<
      EventPriority,
      string
    >
  return {
    dateSize: isDateSize(v.dateSize) ? v.dateSize : DEFAULT_CALENDAR_PREFS.dateSize,
    eventSize: isDateSize(v.eventSize) ? v.eventSize : DEFAULT_CALENDAR_PREFS.eventSize,
    sidePadding: isSidePadding(v.sidePadding) ? v.sidePadding : DEFAULT_CALENDAR_PREFS.sidePadding,
    eventsPerDay: isEventsPerDay(v.eventsPerDay) ? v.eventsPerDay : DEFAULT_CALENDAR_PREFS.eventsPerDay,
    colors: pick(c, isHex, DEFAULT_CALENDAR_PREFS.colors),
    textColors: pick(t, isTextColor, DEFAULT_CALENDAR_PREFS.textColors),
  }
}

// 地の色に載せる文字の色。WCAG の相対輝度で、明るい地は濃い灰、暗い地は白
export function readableTextColor(hex: string): string {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  // 白との対比と濃い灰 (#1f2937、輝度 ≒ 0.019) との対比の大きいほう
  return (1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.069 ? '#ffffff' : '#1f2937')
}

// 優先度の帯の文字の色。自動なら地の明るさから選ぶ
export function eventTextColor(prefs: CalendarPrefs, priority: EventPriority): string {
  const chosen = prefs.textColors[priority]
  return chosen === AUTO_TEXT ? readableTextColor(prefs.colors[priority]) : chosen
}
