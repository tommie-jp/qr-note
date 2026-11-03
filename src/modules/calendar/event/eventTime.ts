// 予定の日時を Date にする (docs/126 §1-2)。時刻は JST 固定で、サーバや
// 端末の TZ に依らない (`+09:00` を明示して組む)
import type { EventFields } from './parseEvent'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

// YYYY-MM-DD HH:MM (JST) → Date
export function jstDate(date: string, time = '00:00'): Date {
  return new Date(`${date}T${time}:00+09:00`)
}

// YYYY-MM-DD に日数を足す (暦の計算だけ。TZ は関係しない)
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

export interface EventSpan {
  start: Date
  // 半開区間の終わり (この時刻は含まない)。終日なら最終日の翌 00:00
  end: Date
  allDay: boolean
}

export function eventSpan(fields: EventFields): EventSpan {
  const last = fields.until ?? fields.date
  if (fields.start === null) {
    return { start: jstDate(fields.date), end: jstDate(addDays(last, 1)), allDay: true }
  }
  const start = jstDate(fields.date, fields.start)
  const end =
    fields.end !== null
      ? jstDate(last, fields.end)
      : new Date(jstDate(last, fields.start).getTime() + HOUR_MS)
  return { start, end, allDay: false }
}

// Date → JST の YYYY-MM-DD と HH:MM
export function jstParts(at: Date): { date: string; time: string } {
  const shifted = new Date(at.getTime() + 9 * HOUR_MS).toISOString()
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) }
}
