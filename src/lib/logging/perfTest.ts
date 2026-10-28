// 計測テストの手順 (docs/120-計測テスト自動化計画.md §2)。
//
// メニューの「計測テスト開始」で、docs/118 §0-1 の操作 (検索 3 語 → ノートを
// 開く → 同期) をブラウザが自分で流す。PC でも iPhone でも同じ手順で、
// 人が打つ速さの違いが数字に混ざらない。
//
// ここは**手順の並びだけ**を持ち、DOM・時計・送信は手足 (PerfTestDeps) で
// 受け取る。実際の手足は components/diag/PerfTestRunner.tsx が組む。
import type { PerfField } from './perfLine'

// 打つ語。回路図の少ない語・中くらい・多い語 (docs/118 §0-2 と同じ)
export const PERF_TEST_QUERIES = ['抵抗', 'コンデンサ', 'オペアンプ'] as const

// 段階: 検索 3 語 + ノート + 同期
const TOTAL_STEPS = PERF_TEST_QUERIES.length + 2

// 打ち終えてから計測が始まるまでの待ち (検索の debounce 300ms + 余裕)
const AFTER_TYPE_MS = 700
// 計測が閉じるのを待つ上限。閉じない計測は perfClient が 15 秒で「未着」に
// するので、それより少し長く待ってから見切る
const IDLE_TIMEOUT_MS = 20_000
const IDLE_POLL_MS = 100
// 計測が閉じた後、次の操作の前に置く間 (裏の prefetch と送信を落ち着かせる)
const SETTLE_MS = 1500
// 読み込み直した直後、ページ自身の残りと同期を待つ間
const WARMUP_MS = 3000

export interface PerfTestStatus {
  step: number
  total: number
  label: string
  done: boolean
}

export interface PerfTestDeps {
  sleep: (ms: number) => Promise<void>
  now: () => number
  // 進行中の計測が無いか (perfClient の isPerfIdle)
  isIdle: () => boolean
  // 検索窓に 1 文字ずつ打つ
  typeQuery: (query: string) => Promise<void>
  // 一覧のノートを 1 件開く。開けるノートが無ければ false
  openNote: () => boolean
  sync: () => Promise<void>
  send: (kind: string, fields: readonly PerfField[]) => void
  flush: () => void
  report: (status: PerfTestStatus) => void
  // 開始の印に添える端末の様子 (ペイン構成・画面の幅など)
  describe: () => readonly PerfField[]
}

async function waitIdle(deps: PerfTestDeps): Promise<void> {
  const deadline = deps.now() + IDLE_TIMEOUT_MS
  while (!deps.isIdle() && deps.now() < deadline) {
    await deps.sleep(IDLE_POLL_MS)
  }
  await deps.sleep(SETTLE_MS)
}

export async function runPerfTest(deps: PerfTestDeps): Promise<void> {
  const report = (step: number, label: string, done = false) =>
    deps.report({ step, total: TOTAL_STEPS, label, done })
  const startedAt = deps.now()

  await deps.sleep(WARMUP_MS)
  deps.send('テスト', [['結果', '開始'], ...deps.describe()])

  for (const [i, query] of PERF_TEST_QUERIES.entries()) {
    report(i + 1, `「${query}」を検索`)
    await deps.typeQuery(query)
    await deps.sleep(AFTER_TYPE_MS)
    await waitIdle(deps)
  }

  report(TOTAL_STEPS - 1, 'ノートを開く')
  if (deps.openNote()) {
    await waitIdle(deps)
  } else {
    deps.send('テスト', [['結果', 'ノートなし']])
  }

  report(TOTAL_STEPS, '同期')
  try {
    await deps.sync()
  } catch {
    // 同期の失敗は同期の行 (sync.ts) と console に残る。テストは先へ進める
    deps.send('テスト', [['結果', '同期失敗']])
  }

  deps.send('テスト', [
    ['結果', '完了'],
    ['全体', `${Math.round(deps.now() - startedAt)}ms`],
  ])
  deps.flush()
  report(TOTAL_STEPS, '完了', true)
}
