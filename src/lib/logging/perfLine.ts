// 速度計測の 1 行 (docs/119-速度計測ログ計画.md §1-1)。
//
//   [計測] 検索 q="抵抗" panes=3 全体=624ms 応答開始=120ms … サーバ=23ms(検索=3 …)
//
// サーバ (段階の計時) もブラウザ (観測) も、行はここで組み立てる。書式が
// 2 か所にあると、片方だけ直して表計算に貼ったときに列がずれる。
//
// **key の順序は呼ぶ側が渡す配列の順**。種別ごとに呼ぶ場所は 1 か所なので、
// そこで並びを固定すれば「左から右へ時間の流れ順」が保たれる (`[起動]` 行と
// 同じ考え。どこで急に増えたかを目で追う)。
//
// 状態を持たない葉。ブラウザ・サーバ・テストのどこからでも読める

export const PERF_PREFIX = '[計測]'

// 値が null / undefined の項目は出さない (その場面では測らない物)
export type PerfValue = string | number | null | undefined
export type PerfField = readonly [key: string, value: PerfValue]

// 検索語は 20 文字で切る (§1-5)。行に検索語の全文を残さない
const QUERY_LIMIT = 20

const KIB = 1024

// 時間。**立っていない印は 0ms と書かない** — 「一瞬で終わった」に読めて
// 意味が反対になる (bootTiming.ts の msOrPending と同じ判断)
export function perfMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '未了'
  }
  return `${Math.round(value)}ms`
}

// 量。null は「測れない」
export function perfKB(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return '?'
  }
  return `${Math.round(bytes / KIB)}KB`
}

// メモリ量 (rss など)。MB の整数
export function perfMB(bytes: number): string {
  return `${Math.round(bytes / (KIB * KIB))}MB`
}

// 検索語を行に載せる形にする。空白で区切る行なので引用符で包み、中の
// 引用符・改行・空白は _ に潰す (表計算で空白区切りにしたとき列がずれない)
export function perfQuery(query: string): string {
  const flat = query.trim().replace(/["\s]+/g, '_')
  const cut = flat.length > QUERY_LIMIT ? `${flat.slice(0, QUERY_LIMIT)}…` : flat
  return `"${cut}"`
}

function formatValue(value: string | number): string {
  return typeof value === 'number' ? String(Math.round(value)) : value
}

export function formatPerfLine(kind: string, fields: readonly PerfField[]): string {
  const parts = fields.flatMap(([key, value]) =>
    value === null || value === undefined || value === ''
      ? []
      : [`${key}=${formatValue(value)}`],
  )
  return [PERF_PREFIX, kind, ...parts].join(' ')
}

// サーバの段階 (logging/phase.ts の PerfPhases) を 1 項目に畳む。
//   23ms(検索=3 特性=0 サムネ=2)
// 段階が 1 つも無ければ全体だけ
export function formatPhaseSummary(perf: {
  totalMs: number
  phases: Readonly<Record<string, number>>
}): string {
  const inner = Object.entries(perf.phases)
    .map(([name, ms]) => `${name}=${Math.round(ms)}`)
    .join(' ')
  return inner === '' ? perfMs(perf.totalMs) : `${perfMs(perf.totalMs)}(${inner})`
}

// Server-Timing ヘッダの値 (同期の口。§2-3)。名前は ASCII の token で
// なければならない (RFC 8941 の token) ので、日本語の段階名は渡さないこと
export function formatServerTiming(phases: Readonly<Record<string, number>>): string {
  return Object.entries(phases)
    .filter(([name]) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(name))
    .map(([name, ms]) => `${name};dur=${Math.round(ms)}`)
    .join(', ')
}
