// カレンダーの表示の設定 (docs/126 §1-12)。日付の文字の大きさと、優先度ごとの色。
// DB にも React にも触らない純関数で、サーバ (検査・既定) と端末 (描く) が共有する。
//
// 保存は user_settings の 1 行 (key = calendar-prefs、値は JSON)。端末をまたいで効く
import type { EventPriority } from './parseEvent'

export type DateSize = 'sm' | 'md' | 'lg'

export interface CalendarPrefs {
  dateSize: DateSize
  // #rrggbb (小文字)
  colors: Record<EventPriority, string>
}

export const CALENDAR_PREFS_SETTING_KEY = 'calendar-prefs'

export const DATE_SIZES: readonly { value: DateSize; label: string }[] = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
]

// 既定は §1-11 の色 (Tailwind の red/orange/green-200)
export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = {
  dateSize: 'md',
  colors: { high: '#fecaca', normal: '#fed7aa', low: '#bbf7d0' },
}

// メニューに並べるテンプレート色 (薄い 9 色 + SaiSuke2 風の濃い 5 色)
export const TEMPLATE_COLORS: readonly string[] = [
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
const isHex = (value: unknown): value is string => typeof value === 'string' && HEX.test(value)

// API の入口。知らない値は畳まず断る (送り手が保存できたと思い込まないように)
export function validateCalendarPrefs(value: unknown): CalendarPrefs | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { dateSize, colors } = value as { dateSize?: unknown; colors?: unknown }
  if (!isDateSize(dateSize) || typeof colors !== 'object' || colors === null) {
    return null
  }
  const c = colors as Record<string, unknown>
  if (!PRIORITIES.every((p) => isHex(c[p]))) {
    return null
  }
  return {
    dateSize,
    colors: { high: String(c.high).toLowerCase(), normal: String(c.normal).toLowerCase(), low: String(c.low).toLowerCase() },
  }
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
  const v = (typeof value === 'object' && value !== null ? value : {}) as { dateSize?: unknown; colors?: unknown }
  const c = (typeof v.colors === 'object' && v.colors !== null ? v.colors : {}) as Record<string, unknown>
  const color = (p: EventPriority) => (isHex(c[p]) ? String(c[p]).toLowerCase() : DEFAULT_CALENDAR_PREFS.colors[p])
  return {
    dateSize: isDateSize(v.dateSize) ? v.dateSize : DEFAULT_CALENDAR_PREFS.dateSize,
    colors: { high: color('high'), normal: color('normal'), low: color('low') },
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
