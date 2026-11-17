// 計測テストの後半: ノートの遷移を確かめる (docs/123 §12-6)。
//
// 一覧からノートを開く遷移は端末で済ませる (pushState。docs/123 §12)。その
// 周りの操作 (戻る・進む・前後ナビ・開いたままの表示切替・ペイン切替・引っ張って
// 更新・一覧へ戻る・1 ペインの「閉じる」) が、サーバの殻を取りに行かずに、
// 検索画面を壊さずに動くかを、計測テスト (perfTest.ts) の中で自動で流して
// 判定する。人が実機で触って確かめていた手順を、ベンチマークの釦 1 つにまとめる。
//
// 1 操作ごとに `[計測] 遷移 操作=… 判定=OK|NG 時間=…ms RSC=… 理由=…` を送る。
// 「結果」の項目を使わないのは、ベンチの要約 (clientBenchHarvest) が
// 「結果」のある行を中断・未着として捨てるため。
//
// ここは**手順の並びと判定だけ**を持ち、DOM は手足 (NavCheckDeps) で受け取る。
// 実際の手足は components/diag/navCheckDom.ts
import type { PerfField } from './perfLine'

// 画面の今の様子 (手足が DOM から読む)
export interface NavSnapshot {
  // location.pathname
  path: string
  // 選んだノートの器 (横取り・端末のどちらも) が出しているノートの id。無ければ null
  noteId: string | null
  // 検索の一覧の器があるか (全画面のノートに置き換わっていないか)
  hasList: boolean
  // 見せているペイン構成 ('1' | '2' | '3')
  panes: string
  // 1 ペインの一覧のスクロール位置
  scrollY: number
}

export interface NavCheckDeps {
  sleep: (ms: number) => Promise<void>
  now: () => number
  snapshot: () => NavSnapshot
  // t0 以降に path へ向けた RSC (`_rsc=`) の要求の数。先読みは行き先が違うので数えない
  rscSince: (path: string, t0: number) => number
  // t0 以降に path へ向けた API の要求の数 (RSC を除く。引っ張って更新の取り直しを見る)
  apiSince: (path: string, t0: number) => number
  back: () => void
  forward: () => void
  // ノートの器の「次 →」を押す。無ければ false
  clickNext: () => boolean
  // ペイン構成の釦を 1 回押す (3 → 2 → 1 → 3 の循環)。無ければ false
  pressPaneButton: () => boolean
  // 表示モードの釦を 1 回押す。無ければ false
  pressViewButton: () => boolean
  // 一覧の器を先頭へ戻し、引っ張って更新を起こす。タッチ端末でなければ false
  pullToRefresh: () => Promise<boolean>
  // 1 ペインのノートの器の「閉じる」を押す。無ければ false
  clickClose: () => boolean
  // 一覧の index 番目 (0 始まり) のノートを開く
  openNote: (index: number) => boolean
  // 検索窓に打つ (前後ナビは検索語のある一覧から開いたノートにだけ出る)
  typeQuery: (query: string) => Promise<void>
  // 1 ペインの一覧を下へ送る (閉じた後にスクロール位置が残るかを見るため)
  scrollListBy: (dy: number) => void
  send: (kind: string, fields: readonly PerfField[]) => void
}

// 条件が揃うまで待つ上限と間隔
const WAIT_TIMEOUT_MS = 5000
const POLL_MS = 30
// 操作の後、次へ進む前の間 (裏の取得・描画を落ち着かせる)
const SETTLE_MS = 800
// ペイン・表示の釦を押した後の待ち (cookie の保存と描き替え)
const SWITCH_SETTLE_MS = 1500
// 一覧へ戻るときに戻る回数の上限 (開いたノートの数より多めに)
const MAX_BACKS = 8
// 1 ペインの「閉じる」の前に一覧を送る量
const CLOSE_SCROLL_PX = 300
// ペインの循環 (3 → 2 → 1 → 3) の長さ
const PANE_CYCLE = 3

// 操作の数 (perfTest の段数に足す。nextStep の呼び出し回数と一致させる)。準備 + 8
export const NAV_CHECK_STEPS = 9

// 準備で打つ語。前後ナビ (「次 →」) が出るよう、2 件以上あたる語にする
export const NAV_CHECK_QUERY = '抵抗'
// 打ち終えてから一覧が差し替わるまでの待ち (検索の debounce 300ms + 余裕)
const AFTER_TYPE_MS = 1000

// 一覧の API (引っ張って更新で取り直す口)
const LIST_API = '/api/items'

export const isNotePath = (path: string): boolean => /^\/item\/[^/]+$/.test(path)

interface Verdict {
  ok: boolean
  reason?: string
}

async function waitUntil(
  deps: NavCheckDeps,
  cond: (snap: NavSnapshot) => boolean,
): Promise<{ met: boolean; ms: number; snap: NavSnapshot }> {
  const t0 = deps.now()
  for (;;) {
    const snap = deps.snapshot()
    if (cond(snap)) {
      return { met: true, ms: deps.now() - t0, snap }
    }
    if (deps.now() - t0 >= WAIT_TIMEOUT_MS) {
      return { met: false, ms: deps.now() - t0, snap }
    }
    await deps.sleep(POLL_MS)
  }
}

// 計測行は空白で項目を区切る (perfLine.ts) ので、値の空白は詰める
export const noSpace = (text: string): string => text.replace(/\s+/g, '')

function report(
  deps: NavCheckDeps,
  name: string,
  verdict: Verdict,
  extra: readonly PerfField[] = [],
): void {
  deps.send('遷移', [
    ['操作', noSpace(name)],
    ['判定', verdict.ok ? 'OK' : 'NG'],
    ...extra,
    ...(verdict.reason ? ([['理由', noSpace(verdict.reason)]] as const) : []),
  ])
}

// ノートを開いたまま、一覧と器が残っているか (置き換わり・閉じ忘れの検出)
function keptNote(snap: NavSnapshot, path: string, noteId: string | null): Verdict {
  if (!snap.hasList) return { ok: false, reason: '一覧が消えた' }
  if (snap.path !== path) return { ok: false, reason: `URL が ${snap.path} に変わった` }
  if (snap.noteId !== noteId) return { ok: false, reason: 'ノートが変わった' }
  return { ok: true }
}

// ノートへ移る操作 (戻る・進む・次へ) を 1 つ流して判定する
async function checkMove(
  deps: NavCheckDeps,
  name: string,
  act: () => boolean,
  expected: (before: NavSnapshot, after: NavSnapshot) => boolean,
): Promise<void> {
  const before = deps.snapshot()
  const t0 = deps.now()
  if (!act()) {
    report(deps, name, { ok: false, reason: '釦なし' })
    return
  }
  const result = await waitUntil(
    deps,
    (snap) => isNotePath(snap.path) && snap.path !== before.path && snap.noteId !== null && expected(before, snap),
  )
  const rsc = deps.rscSince(result.snap.path, t0)
  const verdict: Verdict = !result.met
    ? { ok: false, reason: 'ノートが出ない' }
    : !result.snap.hasList
      ? { ok: false, reason: '一覧が消えた' }
      : rsc > 0
        ? { ok: false, reason: '殻を取りに行った' }
        : { ok: true }
  report(deps, name, verdict, [
    ['時間', `${Math.round(result.ms)}ms`],
    ['RSC', rsc],
  ])
  await deps.sleep(SETTLE_MS)
}

// ノートを開いたまま操作し、検索画面とノートが残るかを見る
async function checkKeep(
  deps: NavCheckDeps,
  name: string,
  act: () => Promise<boolean>,
): Promise<boolean> {
  const before = deps.snapshot()
  const t0 = deps.now()
  if (!(await act())) {
    // 途中で釦が消えたのは、たいてい検索画面ごと置き換わったから
    report(deps, name, { ok: false, reason: deps.snapshot().hasList ? '釦なし' : '一覧が消えた' })
    return false
  }
  await deps.sleep(SETTLE_MS)
  const after = deps.snapshot()
  const rsc = deps.rscSince(before.path, t0)
  const kept = keptNote(after, before.path, before.noteId)
  const verdict: Verdict = !kept.ok ? kept : rsc > 0 ? { ok: false, reason: '殻を取りに行った' } : kept
  report(deps, name, verdict, [['RSC', rsc]])
  return true
}

async function pressPaneUntil(deps: NavCheckDeps, panes: string): Promise<boolean> {
  for (let i = 0; i < PANE_CYCLE && deps.snapshot().panes !== panes; i += 1) {
    if (!deps.pressPaneButton()) return false
    await deps.sleep(SWITCH_SETTLE_MS)
  }
  return deps.snapshot().panes === panes
}

// 一覧へ戻る。遅らせた refresh (navigation.ts の refreshRouter) がここで流れる
async function checkBackToList(deps: NavCheckDeps, deferred: boolean): Promise<void> {
  const t0 = deps.now()
  for (let i = 0; i < MAX_BACKS && isNotePath(deps.snapshot().path); i += 1) {
    deps.back()
    await deps.sleep(SETTLE_MS / 2)
  }
  const result = await waitUntil(deps, (snap) => !isNotePath(snap.path))
  await deps.sleep(SETTLE_MS)
  const after = deps.snapshot()
  const refreshed = deps.rscSince('/', t0)
  const verdict: Verdict = !result.met
    ? { ok: false, reason: '一覧へ戻れない' }
    : !after.hasList
      ? { ok: false, reason: '一覧が消えた' }
      : deferred && refreshed === 0
        ? { ok: false, reason: '遅らせた更新が流れない' }
        : { ok: true }
  report(deps, '一覧へ戻る', verdict, [['更新', refreshed]])
}

// 1 ペインで開いて「閉じる」。一覧に戻り、スクロール位置が残るか
async function checkCloseInOnePane(deps: NavCheckDeps): Promise<void> {
  const original = deps.snapshot().panes
  try {
    if (!(await pressPaneUntil(deps, '1'))) {
      report(deps, '1 ペインで閉じる', { ok: false, reason: '1 ペインにできない' })
      return
    }
    deps.scrollListBy(CLOSE_SCROLL_PX)
    await deps.sleep(SETTLE_MS)
    const listPath = deps.snapshot().path
    const scrollY = deps.snapshot().scrollY
    if (!deps.openNote(1)) {
      report(deps, '1 ペインで閉じる', { ok: false, reason: 'ノートなし' })
      return
    }
    const opened = await waitUntil(deps, (snap) => isNotePath(snap.path) && snap.noteId !== null)
    if (!opened.met) {
      report(deps, '1 ペインで閉じる', { ok: false, reason: 'ノートが出ない' })
      return
    }
    await deps.sleep(SETTLE_MS)
    const t0 = deps.now()
    if (!deps.clickClose()) {
      report(deps, '1 ペインで閉じる', { ok: false, reason: '閉じる釦なし' })
      return
    }
    const closed = await waitUntil(deps, (snap) => snap.path === listPath && snap.noteId === null)
    const verdict: Verdict = !closed.met
      ? { ok: false, reason: '閉じない' }
      : !closed.snap.hasList
        ? { ok: false, reason: '一覧が消えた' }
        : closed.snap.scrollY !== scrollY
          ? { ok: false, reason: `スクロールが ${scrollY} → ${closed.snap.scrollY}` }
          : { ok: true }
    report(deps, '1 ペインで閉じる', verdict, [
      ['時間', `${Math.round(deps.now() - t0)}ms`],
      ['RSC', deps.rscSince(opened.snap.path, t0)],
    ])
  } finally {
    // ペイン構成は利用者の cookie。途中で何があっても元へ戻す
    if (!(await pressPaneUntil(deps, original))) {
      report(deps, 'ペインを戻す', { ok: false, reason: `${original} に戻せない` })
    }
  }
}

// 検索語のある一覧から 2 件を開き、「一覧 → ノート a → ノート b」の履歴を作る
async function prepare(deps: NavCheckDeps): Promise<boolean> {
  await deps.typeQuery(NAV_CHECK_QUERY)
  await deps.sleep(AFTER_TYPE_MS)
  const listed = await waitUntil(deps, (snap) => !isNotePath(snap.path) && snap.hasList)
  if (!listed.met) return false
  for (const index of [1, 2]) {
    const before = deps.snapshot().path
    if (!deps.openNote(index)) return false
    const opened = await waitUntil(deps, (snap) => isNotePath(snap.path) && snap.path !== before && snap.noteId !== null)
    if (!opened.met) return false
    await deps.sleep(SETTLE_MS)
  }
  return true
}

// 計測テストのノートを開いた後に流す
export async function runNavChecks(
  deps: NavCheckDeps,
  nextStep: (label: string) => void,
): Promise<void> {
  nextStep('遷移: 準備')
  if (!(await prepare(deps))) {
    report(deps, '準備', { ok: false, reason: 'ノートを開けない' })
    return
  }

  nextStep('遷移: 戻る')
  const atB = deps.snapshot()
  await checkMove(deps, '戻る', () => (deps.back(), true), (_b, a) => a.noteId !== atB.noteId)

  nextStep('遷移: 進む')
  await checkMove(deps, '進む', () => (deps.forward(), true), (_b, a) => a.noteId === atB.noteId)

  nextStep('遷移: 次へ')
  await checkMove(deps, '次へ', deps.clickNext, (b, a) => a.noteId !== b.noteId)

  // ここから先の 3 つは refresh を伴う。ノートを出している間は遅らせる
  let deferred = false

  nextStep('遷移: 開いたまま表示切替')
  deferred =
    (await checkKeep(deps, '開いたまま表示切替', async () => {
      // 1 つ進めて、循環 (4 つ) を回って元へ戻す
      for (let i = 0; i < 4; i += 1) {
        if (!deps.pressViewButton()) return false
        await deps.sleep(SWITCH_SETTLE_MS)
      }
      return true
    })) || deferred

  nextStep('遷移: 開いたままペイン切替')
  deferred =
    (await checkKeep(deps, '開いたままペイン切替', async () => {
      for (let i = 0; i < PANE_CYCLE; i += 1) {
        if (!deps.pressPaneButton()) return false
        await deps.sleep(SWITCH_SETTLE_MS)
      }
      return true
    })) || deferred

  nextStep('遷移: 開いたまま引っ張って更新')
  const beforePull = deps.snapshot()
  const pulledAt = deps.now()
  if (await deps.pullToRefresh()) {
    await deps.sleep(SWITCH_SETTLE_MS)
    // 発火したかは一覧の取り直し (控えを古くした後の /api/items) で見る
    const refetched = deps.apiSince(LIST_API, pulledAt)
    const kept = keptNote(deps.snapshot(), beforePull.path, beforePull.noteId)
    report(
      deps,
      '開いたまま引っ張って更新',
      !kept.ok ? kept : refetched === 0 ? { ok: false, reason: '更新が起きない' } : kept,
      [['取り直し', refetched]],
    )
    deferred = true
  } else {
    report(deps, '開いたまま引っ張って更新', { ok: true, reason: 'タッチ端末でない' })
  }

  nextStep('遷移: 一覧へ戻る')
  await checkBackToList(deps, deferred)

  nextStep('遷移: 1 ペインで閉じる')
  await checkCloseInOnePane(deps)
}
