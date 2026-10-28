// サーバの段階を行にして控え、ブラウザへ渡す印を作る (docs/119 §2)。
import 'server-only'
import type { PerfMarksProps } from '@/components/diag/PerfMarks'
import { pushPerfLine } from './buffer'
import type { PerfPhases } from './phase'
import { formatPerfLine, formatPhaseSummary, perfMs, type PerfField } from './perfLine'
import { isPerfLogEnabled } from './perfSwitch'

// ノートの枠を組むまでに測った段階 (ItemDetail → ItemView → 本文へ運ぶ。§2-2)。
// 本文は Suspense の奥で後から描かれるので、全体は壁時計 (startedAt) で測る
export interface NoteLoadPerf {
  startedAt: number
  phases: Record<string, number>
  // 置き場所 (page = 全画面 / pane = 横取り / auto = 3 ペインの先頭)
  shell: string
}

// 枠の段階と本文の段階を合わせ、全体を枠を組み始めてからの壁時計にする
export function notePerfSince(load: NoteLoadPerf, own: PerfPhases): PerfPhases {
  return {
    totalMs: Date.now() - load.startedAt,
    phases: { ...load.phases, ...own.phases },
  }
}

// これより遅い SQL だけを行にする (§2-4)
const SLOW_QUERY_MS = 50
// 文は先頭だけ。パラメータは載せない (本文の断片や検索語が入る。§1-5)
const SLOW_QUERY_TEXT_LIMIT = 200

// サーバの行 (`[計測] 検索/サーバ …`) を積み、ブラウザへ渡す印の props を返す。
// 計測していなければ (perf が null) 何もせず null
export function reportServerPerf(
  kind: PerfMarksProps['kind'],
  fields: readonly PerfField[],
  perf: PerfPhases | null,
  itemId?: string,
): PerfMarksProps | null {
  if (perf === null) {
    return null
  }
  const server = formatPhaseSummary(perf)
  pushPerfLine(formatPerfLine(`${kind}/サーバ`, [...fields, ['サーバ', server]]))
  return { kind, itemId, at: Date.now(), fields, server }
}

// 段階だけの行 (フォルダー・同期など、ブラウザの印を伴わない物)
export function reportServerLine(
  kind: string,
  fields: readonly PerfField[],
  perf: PerfPhases | null,
): void {
  if (perf === null) {
    return
  }
  pushPerfLine(formatPerfLine(kind, [...fields, ['サーバ', formatPhaseSummary(perf)]]))
}

// Prisma の query イベントから遅い SQL を拾う (db.ts が仕掛ける)
export function reportSlowQuery(event: { duration: number; query: string }): void {
  if (event.duration < SLOW_QUERY_MS || !isPerfLogEnabled()) {
    return
  }
  const text = event.query.replace(/\s+/g, ' ').trim().slice(0, SLOW_QUERY_TEXT_LIMIT)
  pushPerfLine(
    formatPerfLine('遅いSQL', [
      ['時間', perfMs(event.duration)],
      ['文', JSON.stringify(text)],
    ]),
  )
}
