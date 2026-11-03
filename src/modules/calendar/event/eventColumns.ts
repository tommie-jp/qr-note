// 予定の派生列 (docs/126 §1-2)。正本は memo で、保存のたびに
// derivedFromMemo (items/write.ts) がここを通して作り直す。
// 月の範囲検索のための列で、表示はしない
import { extractProps } from '@/lib/markdown/props'
import { eventSpan } from './eventTime'
import { parseEvent } from './parseEvent'

export interface EventColumns {
  eventStart: Date | null
  eventEnd: Date | null
  // 繰り返し (Phase 3)。今は常に null
  eventRepeat: string | null
}

const NO_EVENT: EventColumns = { eventStart: null, eventEnd: null, eventRepeat: null }

export function eventColumnsOf(memo: string): EventColumns {
  const fields = parseEvent(extractProps(memo))
  if (fields === null) {
    return NO_EVENT
  }
  const { start, end } = eventSpan(fields)
  return { eventStart: start, eventEnd: end, eventRepeat: null }
}
