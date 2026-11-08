// 月の予定を DB から引く (docs/126 §1-3)。モジュールで DB を触るのはここだけ。
// 行の引き方と溢れの作法は items/search.ts の searchItemRows を共有する
// (健康グラフ・進捗の表と同じ)
import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { CALENDAR_ROW_LIMIT } from '@/lib/items/limits'
import { searchItemRows } from '@/lib/items/search'
import { buildWhere } from '@/lib/items/where'
import { parseStoredProps } from '@/lib/markdown/props'
import { jstDate } from '../event/eventTime'
import { monthGridRange } from '../event/monthLayout'
import { eventPriority, isEventDone, parseEvent } from '../event/parseEvent'
import type { CalendarPayload, EventDto } from './calendarDto'

interface EventRow {
  itemId: string
  title: string
  props: unknown
  eventStart: Date
  eventEnd: Date
}

// timestamp(3) の列 (UTC で入っている) と比べる値。セッションの TZ に
// 左右されないよう、タイムゾーン無しの文字列にして ::timestamp で渡す
function utcTimestamp(at: Date): string {
  return at.toISOString().replace('T', ' ').replace('Z', '')
}

// 月のマス目 (前後の月のはみ出しを含む) に掛かる予定。query は検索式
export async function loadMonthEvents(query: string, month: string): Promise<CalendarPayload> {
  const { first, end } = monthGridRange(month)
  const from = utcTimestamp(jstDate(first))
  const to = utcTimestamp(jstDate(end))
  const where = Prisma.sql`${buildWhere(query)}
    AND event_start IS NOT NULL
    AND event_start < ${to}::timestamp
    AND event_end > ${from}::timestamp`
  const { rows, omitted } = await searchItemRows<EventRow>(
    where,
    Prisma.sql`
      id::text AS "itemId",
      title,
      props,
      event_start AS "eventStart",
      event_end AS "eventEnd"
    `,
    'registered',
    CALENDAR_ROW_LIMIT,
  )
  const events: EventDto[] = rows.map((row) => {
    const props = parseStoredProps(row.props)
    return {
      itemId: row.itemId,
      title: row.title,
      start: row.eventStart.toISOString(),
      end: row.eventEnd.toISOString(),
      // 終日かは本文 (props) から読む。列の時刻からは 0 時始まりの予定と区別できない
      allDay: parseEvent(props)?.start === null,
      done: isEventDone(props),
      priority: eventPriority(props),
    }
  })
  return { events, omitted }
}
