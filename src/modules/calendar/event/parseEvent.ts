// プロパティ行から予定を読む (docs/126 §1-1)。DB にも React にも触らない純関数。
//
// 予定の正本はノート本文のプロパティ行 (`date=2026-11-05 start=10:00`)。
// 読めない値 (`date=来週`、`start=25:00`) があれば予定として扱わない —
// 黙って別の日に出すより、出ないほうが気づける
import type { PropEntry } from '@/lib/markdown/props'

export interface EventFields {
  // YYYY-MM-DD (JST の暦日)
  date: string
  // HH:MM。null なら終日
  start: string | null
  // HH:MM。null なら start + 1 時間 (終日なら使わない)
  end: string | null
  // 複数日の最終日 YYYY-MM-DD。null なら date と同じ日
  until: string | null
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/

// 暦に実在する日か (2026-02-30 を弾く)。YYYY-MM-DD に揃えて返す
export function normalizeDate(value: string): string | null {
  const m = DATE_PATTERN.exec(value)
  if (m === null) {
    return null
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null
  }
  return value
}

// 00:00〜23:59。`9:00` は `09:00` に揃える
export function normalizeTime(value: string): string | null {
  const m = TIME_PATTERN.exec(value)
  if (m === null) {
    return null
  }
  const [h, mi] = [Number(m[1]), Number(m[2])]
  if (h > 23 || mi > 59) {
    return null
  }
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

function valueOf(props: readonly PropEntry[], key: string): string | undefined {
  return props.find((p) => p.key === key)?.value
}

export function parseEvent(props: readonly PropEntry[]): EventFields | null {
  const rawDate = valueOf(props, 'date')
  if (rawDate === undefined) {
    return null
  }
  const date = normalizeDate(rawDate)
  if (date === null) {
    return null
  }
  const rawUntil = valueOf(props, 'until')
  const until = rawUntil === undefined ? null : normalizeDate(rawUntil)
  if (rawUntil !== undefined && (until === null || until < date)) {
    return null
  }
  const rawStart = valueOf(props, 'start')
  const start = rawStart === undefined ? null : normalizeTime(rawStart)
  if (rawStart !== undefined && start === null) {
    return null
  }
  const rawEnd = valueOf(props, 'end')
  // 終日の予定に end だけ書いてあっても意味を持たないので無視する
  if (start === null || rawEnd === undefined) {
    return { date, start, end: null, until: until === date ? null : until }
  }
  const end = normalizeTime(rawEnd)
  // 同じ日のうちに終わる予定で、終わりが始まり以前なのは書き間違い
  if (end === null || (until === null && end <= start)) {
    return null
  }
  return { date, start, end, until: until === date ? null : until }
}

// 済みの予定か (`done=2026-11-08`。値は済ませた日)。値の形は問わない —
// 手で `done=yes` と書いても済みに見せる (予定として出なくなるより気づける)
export function isEventDone(props: readonly PropEntry[]): boolean {
  return (valueOf(props, 'done') ?? '') !== ''
}
