// 計測テストの手順 (docs/120-計測テスト自動化計画.md §2)。
//
// メニューの「計測開始」で、docs/118 §0-1 の操作 (検索 3 語 → ノートを
// 開く → 同期) をブラウザが自分で流し、終わったら計測を止める。PC でも
// iPhone でも同じ手順で、人が打つ速さの違いが数字に混ざらない。
//
// ここは**手順の並びだけ**を持ち、DOM・時計・送信は手足 (PerfTestDeps) で
// 受け取る。実際の手足は components/diag/PerfTestRunner.tsx が組む。
import type { PerfField } from './perfLine'

// 打つ語。回路図の少ない語・中くらい・多い語 (docs/118 §0-2 と同じ)
export const PERF_TEST_QUERIES = ['抵抗', 'コンデンサ', 'オペアンプ'] as const

// 表示モードの切替で辿る順 (小→中→大→画像)。ViewSlot の循環と同じ並び。
// まず小 (VIEW_START) に揃え、ここには**切り替え先**だけを並べる。最後に
// 小へ戻す一手を足して 1 周する。開始時の表示が何でも、測る切替は同じ 5 つ
// (小→中、中→大、大→画像、画像→小) になり、前後を比べられる
export const PERF_TEST_VIEW_ORDER = ['medium', 'card', 'image'] as const
const VIEW_START = 'compact'


// 開くノートの位置 (0 始まり。一覧の行の題名リンク)。1 件だけだと、そのノート
// 固有の重さが「ノートを開く」全体に見える
export const PERF_TEST_NOTE_INDEXES = [1, 2] as const

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
// 最後の行を送り出してから計測を止めるまでの間 (送信は非同期で届く)
const BEFORE_STOP_MS = 2000

// 段階 (nextStep の呼び出し回数と一致させる。テストが数えて確かめる):
// [回線] + 検索 3 語 + 全件 + 表示の切替 (中・大・画像の 3 つ + 小へ戻す 1 つ) +
// 続き + ノート + 同期。回線はベンチマークの画面から流したときだけ (docs/121 §4-2)
export function totalSteps(withNet: boolean): number {
  return (
    (withNet ? 1 : 0) +
    PERF_TEST_QUERIES.length +
    1 +
    (PERF_TEST_VIEW_ORDER.length + 1) +
    1 +
    PERF_TEST_NOTE_INDEXES.length +
    1
  )
}

// 表示モードの切替の区分。揃え (開始時が小以外のとき小へ)・測定 (小→…→小の
// 1 周)・戻し (小から元の表示へ)。揃えと戻しは開始時の表示で回数が変わるので、
// 前後を比べるのは「測定」の行だけにする
export type PerfViewPhase = '揃え' | '測定' | '戻し'

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
  // 検索窓に 1 文字ずつ打つ。空文字なら窓を空にする (全件の検索)
  typeQuery: (query: string) => Promise<void>
  // 一覧の index 番目 (0 始まり) のノートを開く。開けるノートが無ければ false
  openNote: (index: number) => boolean
  // 一覧を下へスクロールして続きを読ませる。続きが無ければ false
  scrollMore: () => boolean
  // 今の表示モード (compact・medium・card・image)
  currentView: () => string
  // 表示モードを to にする (釦を押して循環させる)。釦が無い・着かなければ false。
  // phase は計測の行に載せる区分 (揃え・測定・戻し)。測るのは「測定」だけ
  switchView: (to: string, phase: PerfViewPhase) => Promise<boolean>
  sync: () => Promise<void>
  send: (kind: string, fields: readonly PerfField[]) => void
  flush: () => void
  // 計測を止める (サーバの切替。docs/119 §1-4)
  stop: () => Promise<void>
  report: (status: PerfTestStatus) => void
  // 開始の印に添える端末の様子 (ペイン構成・画面の幅など)
  describe: () => readonly PerfField[]
  // 回線の種別 (有線 / Wi-Fi / キャリア)。あれば 1 段目に回線を測る (docs/121 §4-1)
  line?: string
  // 回線を測って行の項目を返す (logging/netProbe.ts)。line があるときだけ呼ぶ
  measureNet?: () => Promise<readonly PerfField[]>
}

async function waitIdle(deps: PerfTestDeps): Promise<void> {
  const deadline = deps.now() + IDLE_TIMEOUT_MS
  while (!deps.isIdle() && deps.now() < deadline) {
    await deps.sleep(IDLE_POLL_MS)
  }
  await deps.sleep(SETTLE_MS)
}

// 表示モードを順に切り替え、**終わったら必ず元へ戻す**。切替は利用者の cookie
// (view) を書き換えるので、途中で例外が出ても戻さないと、計測の後も表示が
// 変わったままになる
async function runViewSwitches(
  deps: PerfTestDeps,
  nextStep: (label: string) => void,
): Promise<void> {
  const original = deps.currentView()
  try {
    // 開始時が小でなければ、先に小へ揃える (この一手は計測に載るが、
    // 比べる切替は揃えた後の 1 周)
    if (original !== VIEW_START && !(await deps.switchView(VIEW_START, '揃え'))) {
      deps.send('テスト', [['結果', '表示切替なし']])
      return
    }
    for (const to of PERF_TEST_VIEW_ORDER) {
      nextStep(`表示を「${to}」へ`)
      if (!(await deps.switchView(to, '測定'))) {
        deps.send('テスト', [['結果', '表示切替なし']])
        break
      }
      await waitIdle(deps)
    }
    // 1 周の最後 (画像→小)。開始時の表示が小のときは、これが「戻し」を兼ねる
    nextStep('表示を「compact」へ')
    await deps.switchView(VIEW_START, '測定')
    await waitIdle(deps)
  } catch (error) {
    // 切替で例外が出ても、残りの手順 (ノート・同期) は流す。記録は残す
    console.warn('計測テスト: 表示モードの切替に失敗しました', error)
    deps.send('テスト', [['結果', '表示切替失敗']])
  }
  // 元の表示に戻す一手も計測に載る (画像から小へ戻る重さが分かる)。
  // 例外の後でも必ず通す
  try {
    if (deps.currentView() !== original) {
      await deps.switchView(original, '戻し')
      await waitIdle(deps)
    }
  } catch (error) {
    console.warn('計測テスト: 表示モードを元へ戻せませんでした', error)
    deps.send('テスト', [['結果', '表示戻し失敗']])
  }
}

export async function runPerfTest(deps: PerfTestDeps): Promise<void> {
  const withNet = deps.line !== undefined && deps.measureNet !== undefined
  const total = totalSteps(withNet)
  let step = 0
  const nextStep = (label: string) => {
    step += 1
    deps.report({ step, total, label, done: false })
  }
  const startedAt = deps.now()

  await deps.sleep(WARMUP_MS)
  deps.send('テスト', [
    ['結果', '開始'],
    ...deps.describe(),
    ...(deps.line === undefined ? [] : ([['回線', deps.line]] as const)),
  ])

  if (withNet && deps.measureNet) {
    nextStep('回線を測る')
    try {
      deps.send('回線', [['種別', deps.line], ...(await deps.measureNet())])
    } catch (error) {
      // 回線が測れなくても残りの手順は流す。記録は残す
      console.warn('計測テスト: 回線を測れませんでした', error)
      deps.send('回線', [['種別', deps.line], ['結果', '失敗']])
    }
  }

  for (const query of PERF_TEST_QUERIES) {
    nextStep(`「${query}」を検索`)
    await deps.typeQuery(query)
    await deps.sleep(AFTER_TYPE_MS)
    await waitIdle(deps)
  }

  // 空の検索 (全件) の 1 ページ目。検索語を消した直後の描き直しを測る
  nextStep('全件を表示')
  await deps.typeQuery('')
  await deps.sleep(AFTER_TYPE_MS)
  await waitIdle(deps)

  await runViewSwitches(deps, nextStep)

  nextStep('続きを読む')
  if (deps.scrollMore()) {
    await waitIdle(deps)
  } else {
    deps.send('テスト', [['結果', '続きなし']])
  }

  for (const index of PERF_TEST_NOTE_INDEXES) {
    nextStep(`ノートを開く (${index + 1} 件目)`)
    if (deps.openNote(index)) {
      await waitIdle(deps)
    } else {
      deps.send('テスト', [['結果', 'ノートなし']])
    }
  }

  nextStep('同期')
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
  await deps.sleep(BEFORE_STOP_MS)
  try {
    await deps.stop()
  } catch {
    // 止められなくても行は取れている。止まっていないことは知らせに出す
    deps.report({ step: total, total, label: '完了 (計測を止められませんでした)', done: true })
    return
  }
  deps.report({ step: total, total, label: '完了', done: true })
}
