// 月ごとの予定の控え (docs/126 §1-3)。一覧の控え (listStore) と同じ入れ物
// (createResourceCache) を使う。書き込みの後は invalidateCalendar で古くする
import 'client-only'
import { apiGet } from '@/lib/client/api'
import { createResourceCache } from '@/lib/client/resourceCache'
import { isCalendarPayload, type CalendarPayload } from '../api/calendarDto'

export interface CalendarKey {
  query: string
  month: string
}

export const calendarCache = createResourceCache<CalendarKey, CalendarPayload>({
  keyOf: ({ query, month }) => `${query}\u0000${month}`,
  maxEntries: 24,
  async fetch({ query, month }) {
    const { data } = await apiGet<unknown>(`/api/calendar?${new URLSearchParams({ q: query, month })}`)
    if (!isCalendarPayload(data)) {
      throw new Error('予定の形が違います')
    }
    return data
  },
})

// どの月に掛かるかは端末では分からない (日付を動かした予定は 2 か月に効く)
// ので全部古くする。消さないので、取り直しの間も前のマス目が残る
export function invalidateCalendar(): void {
  calendarCache.invalidate()
}
