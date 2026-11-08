// 「予定」タブの入力から本文を作る・書き換える (docs/126 §1-4・§1-5)。
// DB にも React にも触らない純関数。
//
// 書き換えは**決まった所だけ**触る (docs/83 §7 の recordMeasurement と同じ作法):
//   - 題名 … 先頭の `# …` 行。無ければ先頭に挿す
//   - 日時 … `date=` を持つプロパティ行の date / start / end のトークン。
//            同じ行の他のキー (until・done を含む)、タグ、本文、添付は触らない
//   - 済み … 同じ行の done= のトークン (setEventDone)
//   - 優先度 … 同じ行の priority= のトークン (入力が優先度を持つときだけ)
// 行を組み直さないことが、本文を正本と言い続ける条件
import { parsePropToken } from '@/lib/markdown/props'
import { parseSearchExpr } from '@/lib/search/parse'
import type { EventPriority } from './parseEvent'
import type { SearchExpr } from '@/lib/search/types'

export interface EventInput {
  title: string
  date: string
  // null なら終日
  start: string | null
  end: string | null
  // 優先度。標準は priority= を書かない。undefined なら本文の値に触らない
  priority?: EventPriority
}

// until (複数日) はフォームに無いので触らない。手で書いた値が残る
const EVENT_KEYS = ['date', 'start', 'end'] as const
const PRIORITY_KEY = 'priority'

// 入力が書き換えるキー (優先度は入力が持つときだけ)
function managedKeys(input: EventInput): readonly string[] {
  return input.priority === undefined ? EVENT_KEYS : [...EVENT_KEYS, PRIORITY_KEY]
}
const HEADING = /^#(?:\s+(.*))?$/
const FENCE = /^\s*(`{3,}|~{3,})/
const DEFAULT_TAG = '予定'
const DONE_KEY = 'done'

function cleanTitle(title: string): string {
  return title.replace(/[\r\n]+/g, ' ').trim()
}

function eventTokens(input: EventInput): string[] {
  const tokens = [`date=${input.date}`]
  if (input.start !== null) {
    tokens.push(`start=${input.start}`)
    if (input.end !== null) {
      tokens.push(`end=${input.end}`)
    }
  }
  if (input.priority !== undefined && input.priority !== 'normal') {
    tokens.push(`${PRIORITY_KEY}=${input.priority}`)
  }
  return tokens
}

// 行が「`date=` を持つプロパティ行」なら、その行のトークンを返す
function eventLineTokens(line: string): string[] | null {
  const tokens = line.trim().split(/[\s　]+/)
  if (tokens.length === 0 || tokens[0] === '') {
    return null
  }
  const parsed = tokens.map(parsePropToken)
  if (parsed.some((p) => p === null)) {
    return null
  }
  return parsed.some((p) => p?.key === 'date') ? tokens : null
}

// 予定のキーのトークンを差し替える。他のキーは位置ごと残す
function replaceEventTokens(tokens: readonly string[], input: EventInput): string[] {
  const wanted = new Map(
    eventTokens(input).map((token) => [token.slice(0, token.indexOf('=')), token]),
  )
  const managed = managedKeys(input)
  const out: string[] = []
  for (const token of tokens) {
    const key = parsePropToken(token)?.key
    if (key !== undefined && managed.includes(key)) {
      const next = wanted.get(key)
      if (next !== undefined) {
        out.push(next)
        wanted.delete(key)
      }
      continue
    }
    out.push(token)
  }
  // 無かったキーは最後の予定キーの後ろへ (date start end の順に並ぶ)
  const lastAt = out.findLastIndex((t) => managed.includes(parsePropToken(t)?.key ?? ''))
  out.splice(lastAt + 1, 0, ...wanted.values())
  return out
}

// コードフェンスの外で最初の `date=` 行。無ければ -1
function findEventLine(lines: readonly string[]): number {
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence
      continue
    }
    if (!inFence && eventLineTokens(lines[i]) !== null) {
      return i
    }
  }
  return -1
}

export function applyEvent(memo: string, input: EventInput): string {
  const newline = memo.includes('\r\n') ? '\r\n' : '\n'
  const lines = memo.split(/\r?\n/)
  const title = cleanTitle(input.title)

  const eventLine = findEventLine(lines)
  if (eventLine >= 0) {
    lines[eventLine] = replaceEventTokens(eventLineTokens(lines[eventLine]) ?? [], input).join(' ')
  } else {
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }
    lines.push(eventTokens(input).join(' '), '')
  }

  replaceTitleLine(lines, title)
  return lines.join(newline)
}

// 題名: 最初の空でない行が見出しなら差し替え、でなければ先頭に挿す (lines を書き換える)
function replaceTitleLine(lines: string[], title: string): void {
  const first = lines.findIndex((line) => line.trim() !== '')
  if (first >= 0 && HEADING.test(lines[first])) {
    lines[first] = `# ${title}`
  } else {
    lines.unshift(`# ${title}`, '')
  }
}

// 時刻だけを差し替える (日の一覧の時刻のパネル。docs/126 §1-14)。start が null なら
// 終日 (start= end= を抜く)。足すときは date= の直後に置く。他のトークンは残す
export function setEventTime(memo: string, start: string | null, end: string | null): string {
  const newline = memo.includes('\r\n') ? '\r\n' : '\n'
  const lines = memo.split(/\r?\n/)
  const eventLine = findEventLine(lines)
  if (eventLine < 0) {
    return memo
  }
  const tokens = (eventLineTokens(lines[eventLine]) ?? []).filter((t) => {
    const key = parsePropToken(t)?.key
    return key !== 'start' && key !== 'end'
  })
  if (start !== null) {
    const at = tokens.findIndex((t) => parsePropToken(t)?.key === 'date') + 1
    tokens.splice(at, 0, `start=${start}`, ...(end === null ? [] : [`end=${end}`]))
  }
  lines[eventLine] = tokens.join(' ')
  return lines.join(newline)
}

// 日の中の並べ替えの番号 (order=) を書く (docs/126 §1-15)。既にあれば位置ごと
// 差し替え、無ければ予定の行の末尾に足す
export function setEventOrder(memo: string, order: number): string {
  const newline = memo.includes('\r\n') ? '\r\n' : '\n'
  const lines = memo.split(/\r?\n/)
  const eventLine = findEventLine(lines)
  if (eventLine < 0) {
    return memo
  }
  const tokens = eventLineTokens(lines[eventLine]) ?? []
  const at = tokens.findIndex((t) => parsePropToken(t)?.key === 'order')
  if (at >= 0) {
    tokens[at] = `order=${order}`
  } else {
    tokens.push(`order=${order}`)
  }
  lines[eventLine] = tokens.join(' ')
  return lines.join(newline)
}

// 題名だけを差し替える (日の一覧のインライン編集。docs/126 §1-13)
export function setEventTitle(memo: string, title: string): string {
  const newline = memo.includes('\r\n') ? '\r\n' : '\n'
  const lines = memo.split(/\r?\n/)
  replaceTitleLine(lines, cleanTitle(title))
  return lines.join(newline)
}

// 予定を済みにする (done=済ませた日) / 戻す (doneDate が null)。予定の行の
// done= だけを差し替える。予定の行が無ければ本文をそのまま返す
export function setEventDone(memo: string, doneDate: string | null): string {
  const newline = memo.includes('\r\n') ? '\r\n' : '\n'
  const lines = memo.split(/\r?\n/)
  const eventLine = findEventLine(lines)
  if (eventLine < 0) {
    return memo
  }
  const tokens = (eventLineTokens(lines[eventLine]) ?? []).filter((t) => parsePropToken(t)?.key !== DONE_KEY)
  if (doneDate !== null) {
    tokens.push(`${DONE_KEY}=${doneDate}`)
  }
  lines[eventLine] = tokens.join(' ')
  return lines.join(newline)
}

// 検索式が必ず求めるタグ (AND で繋がった肯定のタグ)。OR・否定の中は数えない
export function requiredTags(query: string): string[] {
  const walk = (expr: SearchExpr): string[] => {
    switch (expr.op) {
      case 'term':
        return expr.term.kind === 'tag' ? [expr.term.value] : []
      case 'and':
        return expr.children.flatMap(walk)
      default:
        return []
    }
  }
  const expr = parseSearchExpr(query)
  return expr === null ? [] : [...new Set(walk(expr))]
}

// 新しい予定の本文。タグはいま見ているカレンダーの検索式が求めるもの全部
// (足した予定が、見ているカレンダーに必ず出る)。無ければ #予定
export function newEventMemo(input: EventInput, query: string): string {
  const tags = requiredTags(query)
  const tagLine = (tags.length > 0 ? tags : [DEFAULT_TAG]).map((t) => `#${t}`).join(' ')
  return `# ${cleanTitle(input.title)}\n\n${tagLine}\n${eventTokens(input).join(' ')}\n`
}

// いまの本文から題名を読む (フォームの初期値)。先頭の見出しが無ければ空
export function eventTitleOf(memo: string): string {
  const first = memo.split(/\r?\n/).find((line) => line.trim() !== '')
  const m = first === undefined ? null : HEADING.exec(first)
  return m === null ? '' : (m[1] ?? '').trim()
}
