// カレンダーの URL (docs/126 §1-3・§1-5)。月は「何を見ているか」なので URL に
// 持つ (docs/11 §3)。ノートを開く URL にも q と cal を載せる — 端末で開いた
// ノート (pushState) を出している間も検索画面は URL を読むので、cal が
// 落ちると後ろの画面が一覧に戻ってしまう
import { buildItemUrl } from '@/lib/search/url'

export const CAL_PARAM = 'cal'
export const DEFAULT_CALENDAR_QUERY = '#予定'

// いまの URL の cal だけを差し替えたパス (パスはそのまま。ノートを開いた
// /item/<id> の上でも月を送れる)
export function withCalendarMonth(current: URL, month: string | null): string {
  const url = new URL(current.toString())
  if (month === null) {
    url.searchParams.delete(CAL_PARAM)
  } else {
    url.searchParams.set(CAL_PARAM, month)
  }
  return `${url.pathname}${url.search}${url.hash}`
}

// 一覧からカレンダーへ。検索語が空なら既定の検索式を補う
export function calendarEntryHref(query: string, month: string): string {
  const params = new URLSearchParams({ q: query.trim() || DEFAULT_CALENDAR_QUERY, [CAL_PARAM]: month })
  return `/?${params.toString()}`
}

// 予定を「予定」タブで開く URL。date は新しい予定の日付 (未登録のノートのとき)
export function eventNoteHref(itemId: string, query: string, month: string, date?: string): string {
  const base = buildItemUrl(itemId, query, 'updated')
  const url = new URL(base, 'http://x')
  url.searchParams.set(CAL_PARAM, month)
  url.searchParams.set('tab', 'event')
  if (date !== undefined) {
    url.searchParams.set('date', date)
  }
  return `${url.pathname}${url.search}`
}
