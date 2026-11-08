// 月のマス目の並び (docs/126 §1-3)。月曜始まりの 7 列で (SaiSuke2 と同じ)、その月を含む週だけ
// (4〜6 週) 並べる。DB にも React にも触らない純関数で、サーバ (取る範囲) と
// 端末 (描く並び) が同じ計算を使う
import { addDays, jstDate, jstParts } from './eventTime'

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/

// YYYY-MM か (1〜12 月、1970〜9999 年)
export function isMonth(value: string): boolean {
  const m = MONTH_PATTERN.exec(value)
  if (m === null) {
    return false
  }
  const [y, mo] = [Number(m[1]), Number(m[2])]
  return y >= 1970 && y <= 9999 && mo >= 1 && mo <= 12
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

// JST の今日 (YYYY-MM-DD)
export function jstToday(now: Date = new Date()): string {
  return jstParts(now).date
}

export interface MonthGridRange {
  // マス目の最初の日 (月曜) と、最後の日 (日曜) の翌日 (半開区間)
  first: string
  end: string
  weeks: number
}

// 週の中の位置 (月曜 0 〜 日曜 6)
export function mondayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

export function monthGridRange(month: string): MonthGridRange {
  const firstOfMonth = `${month}-01`
  const nextMonth = `${addMonths(month, 1)}-01`
  const first = addDays(firstOfMonth, -mondayIndex(firstOfMonth))
  const lastOfMonth = addDays(nextMonth, -1)
  const end = addDays(lastOfMonth, 7 - mondayIndex(lastOfMonth))
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000)
  return { first, end, weeks: days / 7 }
}

// マス目に並べる日 (YYYY-MM-DD) の配列。長さは weeks × 7
export function monthCells(month: string): string[] {
  const { first, weeks } = monthGridRange(month)
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i))
}

export interface DayEvent {
  itemId: string
  title: string
  // ISO 文字列 (UTC)
  start: string
  end: string
  allDay: boolean
  // 済み (本文の done=)。古い応答には無い
  done?: boolean
}

// 日の中の並び。済みは最後 (済ませた物より残っている物を先に見せる)。
// その中で終日を先に、その後は開始時刻順 (同じなら題名順)
export function compareDayEvents(a: DayEvent, b: DayEvent): number {
  return (
    Number(a.done === true) - Number(b.done === true) ||
    Number(b.allDay) - Number(a.allDay) ||
    Date.parse(a.start) - Date.parse(b.start) ||
    a.title.localeCompare(b.title, 'ja')
  )
}

// 日ごとの予定。複数日の予定は掛かる日すべてに置く。並びは compareDayEvents
export function eventsByDay<T extends DayEvent>(events: readonly T[], days: readonly string[]): Map<string, T[]> {
  const out = new Map<string, T[]>(days.map((d) => [d, []]))
  for (const event of events) {
    const start = Date.parse(event.start)
    const end = Date.parse(event.end)
    for (const day of days) {
      const dayStart = jstDate(day).getTime()
      const dayEnd = jstDate(addDays(day, 1)).getTime()
      if (start < dayEnd && end > dayStart) {
        out.get(day)?.push(event)
      }
    }
  }
  for (const list of out.values()) {
    list.sort(compareDayEvents)
  }
  return out
}

// 予定の時刻の表示 (JST)。終日なら null
export function eventTimeLabel(event: DayEvent): string | null {
  if (event.allDay) {
    return null
  }
  return jstParts(new Date(event.start)).time
}

// 予定の終わりの時刻 (JST)。終日なら null
export function eventEndLabel(event: DayEvent): string | null {
  if (event.allDay) {
    return null
  }
  return jstParts(new Date(event.end)).time
}
