// カレンダーの API が運ぶ形 (docs/126 §1-3)。一覧の ItemDto (本文を丸ごと
// 運ぶ) は使わず、マス目に要る物だけにする。サーバと端末の両方から読む
import type { DayEvent } from '../event/monthLayout'

export type EventDto = DayEvent

export interface CalendarPayload {
  events: EventDto[]
  // 上限を超えて載らなかった件数
  omitted: number
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isIso = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v))

export function isEventDto(value: unknown): value is EventDto {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return isString(v.itemId) && v.itemId !== '' && isString(v.title) && isIso(v.start) && isIso(v.end) && typeof v.allDay === 'boolean'
}

export function isCalendarPayload(value: unknown): value is CalendarPayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return Array.isArray(v.events) && v.events.every(isEventDto) && typeof v.omitted === 'number'
}
