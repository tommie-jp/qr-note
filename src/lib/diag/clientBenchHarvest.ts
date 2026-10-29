// 計測テストの 1 回分を要約して保存する (docs/121 §4-3)。
//
// 計測テスト (docs/120) の行はメモリの環 (200 行) にしか残らず、打鍵ごとに
// 積まれて押し流される。`[計測] テスト 結果=完了` が届いた直後に、その端末の
// 最新の `結果=開始` 以降を 1 回分として拾い、表示に要る数字だけを残す。
//
// 要約 (summarizeRun) は純関数。読み出しと保存だけが I/O
import 'server-only'
import { recentPerfLines } from '../logging/buffer'
import { parsePerfLine } from '../logging/perfLine'
import { saveClientBench } from './benchStore'
import { type ClientBenchRow, type ClientBenchRun, isNetLine, UNKNOWN_LINE } from './benchTypes'

type Parsed = { kind: string; fields: Record<string, string> }

const QUERY_LABELS: readonly (readonly [q: string, label: string])[] = [
  ['"抵抗"', '検索 抵抗'],
  ['"コンデンサ"', '検索 コンデンサ'],
  ['"オペアンプ"', '検索 オペアンプ'],
  ['""', '検索 全件'],
]

const VIEW_LABEL: Readonly<Record<string, string>> = {
  compact: '小',
  medium: '中',
  card: '大',
  image: '画像',
}

// 開始の行の値 (panes・幅) を保存に載せるときの上限。行はブラウザが送る物で、
// そのまま保存すると偽の行でファイルを膨らませられる
const START_FIELD_LIMIT = 32
const clip = (value: string | undefined): string => (value ?? '未了').slice(0, START_FIELD_LIMIT)

// 中断・未着の行は数字にならないので拾わない
const isComplete = (line: Parsed): boolean => line.fields['結果'] === undefined

function pick(fields: Record<string, string>, keys: readonly string[]): string {
  return keys
    .flatMap((key) => (fields[key] === undefined ? [] : [`${key}=${fields[key]}`]))
    .join(' ')
}

const row = (label: string, value: string): ClientBenchRow[] => (value === '' ? [] : [{ label, value }])

function viewLabel(change: string | undefined): string {
  const [from, to] = (change ?? '').split('→')
  return `表示 ${VIEW_LABEL[from] ?? from}→${VIEW_LABEL[to] ?? to}`
}

// 1 回分の行 (古い順) から要約を作る
export function summarizeRun(lines: readonly Parsed[]): ClientBenchRow[] {
  const last = (match: (line: Parsed) => boolean): Parsed | undefined => lines.filter(match).at(-1)

  const net = last((l) => l.kind === '回線')
  const searches = QUERY_LABELS.flatMap(([q, label]) => {
    const line = last((l) => l.kind === '検索' && l.fields.q === q && isComplete(l))
    return line ? row(label, pick(line.fields, ['全体', '応答開始', '受信', '描画', 'RSC'])) : []
  })
  const views = lines
    .filter((l) => l.kind === '表示' && l.fields['区分'] === '測定' && isComplete(l))
    .flatMap((l) => row(viewLabel(l.fields['切替']), pick(l.fields, ['即時', '全体'])))
  const more = last((l) => l.kind === '追加' && isComplete(l))
  const noMore = lines.some((l) => l.kind === 'テスト' && l.fields['結果'] === '続きなし')
  const notes = lines
    .filter((l) => l.kind === 'ノート' && isComplete(l))
    .slice(-2)
    .flatMap((l, i) => row(`ノート ${i + 1}`, pick(l.fields, ['全体', '応答開始', '受信', '描画'])))
  const sync = last((l) => l.kind === '同期')
  const done = last((l) => l.kind === 'テスト' && l.fields['結果'] === '完了')

  return [
    ...(net ? row('回線', pick(net.fields, ['RTT', '下り', '上り'])) : []),
    ...searches,
    ...views,
    ...(more ? row('続き', pick(more.fields, ['全体', '応答開始', '描画'])) : noMore ? row('続き', '続きなし') : []),
    ...notes,
    ...(sync ? row('同期', pick(sync.fields, ['結果', '全体', '応答開始', '転送'])) : []),
    ...(done ? row('全体', done.fields['全体'] ?? '') : []),
  ]
}

// その端末の最新の「開始」から「完了」までを 1 回分にする。揃わなければ null
export function sliceLatestRun(lines: readonly Parsed[]): Parsed[] | null {
  const startAt = lines.findLastIndex((l) => l.kind === 'テスト' && l.fields['結果'] === '開始')
  if (startAt < 0) {
    return null
  }
  const run = lines.slice(startAt)
  const finished = run.some((l) => l.kind === 'テスト' && l.fields['結果'] === '完了')
  const interrupted = run.some((l) => l.kind === 'テスト' && l.fields['結果'] === '中断')
  return finished && !interrupted ? run : null
}

// 届いた項目に完了の行があれば呼ぶ。保存したら true
export async function harvestClientBench(device: string, now: Date = new Date()): Promise<boolean> {
  const lines = recentPerfLines()
    .filter((entry) => entry.source === 'browser' && entry.device === device)
    .reverse()
    .flatMap((entry) => {
      const parsed = parsePerfLine(entry.text)
      return parsed ? [parsed] : []
    })
  const run = sliceLatestRun(lines)
  if (run === null) {
    return false
  }
  const start = run[0].fields
  const line = isNetLine(start['回線']) ? start['回線'] : UNKNOWN_LINE
  const result: ClientBenchRun = {
    version: 1,
    device,
    line,
    panes: clip(start.panes),
    width: clip(start['幅']),
    measuredAt: now.toISOString(),
    rows: summarizeRun(run),
  }
  await saveClientBench(result)
  return true
}

// 受け口 (api/client-logs) が「完了の行が届いたか」を見る
export function hasPerfTestDone(texts: readonly string[]): boolean {
  return texts.some((text) => {
    const parsed = parsePerfLine(text)
    return parsed?.kind === 'テスト' && parsed.fields['結果'] === '完了'
  })
}
