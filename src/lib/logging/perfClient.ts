// ブラウザ側の速度計測の状態 (docs/119-速度計測ログ計画.md §3)。
//
// PerfReport (root layout に、計測中だけ置く) が installPerf() で仕掛け、
// 測る場所 (検索窓・追加読み込み・同期) は perfStart / perfSend を呼ぶだけ。
// **仕掛けられていなければどれも何もしない** — 呼ぶ側に「計測中か」を
// 配らずに済み、計測を切っているときの手間は関数呼び出し 1 回で済む。
//
// resource timing は**自分で受けて控える** (PerformanceObserver)。
// performance.getEntriesByType('resource') の既定の器は 250 件で、
// 1 検索で prefetch が 60 本走ると数回の検索で満杯になり、以降の要求は
// 記録されなくなる。Observer はその器に縛られない。
//
// 行は clientCapture の待ち行列 (kind: 'perf') で送る。3 秒ごとの送信と
// pagehide の Beacon をそのまま借りる。

import { queueClientLog } from './clientCapture'
import {
  formatAbortedLine,
  formatNavLine,
  itemLinkTarget,
  marksClose,
  pickRsc,
  pickViewSwitch,
  sumLongTasks,
  type LongTaskLike,
  type NavKind,
  type NavMeasure,
  type ResourceLike,
  type ServerMarks,
} from './perf'
import { formatPerfLine, type PerfField } from './perfLine'

// 印が届いて画面に出てから、行を閉じるまでの待ち。本体の RSC 要求の
// resource entry は受信完了の後に非同期で届くうえ、差し替えで画面に入った
// 行が撃つ prefetch もこの窓で数えたい
const SETTLE_MS = 1000

// 控える resource entry の上限と保持時間。計測 1 回の窓は数秒なので、
// 古い物は要らない
const RESOURCE_KEEP = 600
const RESOURCE_TTL_MS = 120_000

// これより長く印が届かない計測は「未着」として残す。開いたままのノートを
// 押し直した (何も描き直されない)・旧 URL が別の id へ転送された、などで
// 閉じる印が来ないとき、次の操作まで待つと利用者の手待ちが「全体」に入る
const ACTIVE_TIMEOUT_MS = 15_000

// 見た印 (at) を覚えておく数。戻る/進むでルーターのキャッシュから同じ印が
// 再び描かれても、新しい計測を閉じさせない
const SEEN_MARKS_KEEP = 100

// 同期の entry を待つ上限 (受信完了の後に非同期で届く)
const RESOURCE_WAIT_MS = 1500
const RESOURCE_POLL_MS = 100

interface Closing {
  measure: NavMeasure
  marks: ServerMarks
  committedAt: number
  paintedAt: number | null
  domNodes: number
  timer: ReturnType<typeof setTimeout> | null
}

interface PerfState {
  active: NavMeasure | null
  closing: Closing | null
  resources: ResourceLike[]
  longTasks: LongTaskLike[] | null
  seenMarks: string[]
  teardown: () => void
}

// globalThis に持つ (clientCapture と同じ理由。HMR と StrictMode で二重にしない)
const globalForPerf = globalThis as unknown as { qrNotePerfClient?: PerfState }

function current(): PerfState | undefined {
  return globalForPerf.qrNotePerfClient
}

export function perfNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function send(text: string): void {
  queueClientLog({ level: 'info', text, kind: 'perf' })
}

// 計測中か (同期の計時など、測るための手間が要る所が見る)
export function isPerfActive(): boolean {
  return current() !== undefined
}

// 次の「表示」計測に載せる区分 (揃え・測定・戻し。docs/120 §2)。計測テストが
// 切替の釦を押す直前に置き、perfStart('表示') が 1 回だけ読んで消す。
// 利用者が普段どおり押した切替には区分が付かない (行にも出ない)
let nextViewPhase: string | null = null

export function perfSetViewPhase(phase: string | null): void {
  nextViewPhase = phase
}

// 表示の切替の計測だけ、置かれた区分を 1 回だけ読んで extra に足す。
// 利用者が普段どおり押した切替 (区分なし) は extra のまま
export function withViewPhase(
  kind: NavKind,
  extra: readonly PerfField[] | undefined,
): readonly PerfField[] | undefined {
  if (kind !== '表示') {
    return extra
  }
  const phase = nextViewPhase
  nextViewPhase = null
  return phase === null ? extra : [...(extra ?? []), ['区分', phase]]
}

// 進行中の計測に項目を 1 つ足す (種別が合うときだけ)。表示モードの切替で、
// 押してから見た目が変わるまで (即時) を、描き直しが届くまでの行に載せる
// (docs/118 §10 案 B)。計測中でなければ・閉じた後なら何もしない。
//
// **閉じかけ (印は届いたが行をまだ送っていない) の計測にも足す。** 一覧を
// 端末の控えから即座に描けた切替では、印が「即時」を測る 2 フレームより先に
// 届く (docs/123 §11-6)。閉じかけを見ないと、その回だけ「即時」が抜ける
export function perfAddField(kind: NavKind, field: PerfField): void {
  const s = current()
  if (!s) {
    return
  }
  if (s.active !== null && s.active.kind === kind) {
    s.active = { ...s.active, extra: [...(s.active.extra ?? []), field] }
    return
  }
  const closing = s.closing
  if (closing !== null && closing.measure.kind === kind) {
    closing.measure = { ...closing.measure, extra: [...(closing.measure.extra ?? []), field] }
  }
}

// 進行中・閉じかけの計測が無いか (計測テストが次の操作へ進む合図。
// docs/120 §2)。仕掛けられていなければ常に空いている
export function isPerfIdle(): boolean {
  const s = current()
  return s === undefined || (s.active === null && s.closing === null)
}

// 1 行を送る (同期・添付・暖機など、画面遷移でない計測)
export function perfSend(kind: string, fields: readonly PerfField[]): void {
  if (!isPerfActive()) {
    return
  }
  send(formatPerfLine(kind, fields))
}

function trimResources(s: PerfState): void {
  const floor = perfNow() - RESOURCE_TTL_MS
  s.resources = s.resources.filter((e) => e.startTime >= floor).slice(-RESOURCE_KEEP)
}

function finalize(s: PerfState, closing: Closing): void {
  if (closing.timer !== null) {
    clearTimeout(closing.timer)
  }
  if (s.closing === closing) {
    s.closing = null
  }
  const paintedAt = closing.paintedAt ?? closing.committedAt
  const { measure } = closing
  send(
    formatNavLine(measure, closing.marks, {
      committedAt: closing.committedAt,
      paintedAt,
      // 表示モードの切替は refresh の RSC か、受け皿の Server Action の POST
      rsc: (measure.kind === '表示' ? pickViewSwitch : pickRsc)(s.resources, {
        t0: measure.t0,
        until: perfNow(),
        pathname: measure.pathname,
      }),
      domNodes: closing.domNodes,
      longTasks: s.longTasks ? sumLongTasks(s.longTasks, measure.t0, paintedAt) : null,
    }),
  )
}

// 画面遷移の計測を始める。前の計測が閉じていなければ「中断」で閉じ、
// 閉じかけ (印は届いたが窓が開いている) なら今の時点で閉じる
export function perfStart(
  kind: NavKind,
  pathname: string,
  itemId?: string,
  extra?: readonly PerfField[],
): void {
  const s = current()
  if (!s) {
    return
  }
  const now = perfNow()
  if (s.closing !== null) {
    finalize(s, s.closing)
  }
  if (s.active !== null) {
    send(
      now - s.active.t0 > ACTIVE_TIMEOUT_MS
        ? formatPerfLine(s.active.kind, [['結果', '未着']])
        : formatAbortedLine(s.active, now),
    )
  }
  s.active = {
    kind,
    t0: now,
    pathname,
    itemId,
    extra: withViewPhase(kind, extra),
  }
}

// サーバの印が届いた (PerfMarks の effect = React が描き終えた)。
// 今の計測を閉じてよい印なら、次のフレームで「画面に出た」時刻を取り、
// 窓 (SETTLE_MS) の後に行を送る
export function perfArrive(
  kind: '検索' | 'ノート',
  itemId: string | undefined,
  at: number,
  marks: ServerMarks,
): void {
  const s = current()
  if (!s) {
    return
  }
  // 一度見た印は二度使わない (ルーターのキャッシュから描き直された古い結果)
  const key = `${kind}:${itemId ?? ''}:${at}`
  if (s.seenMarks.includes(key)) {
    return
  }
  s.seenMarks = [...s.seenMarks, key].slice(-SEEN_MARKS_KEEP)
  if (
    s.active === null ||
    perfNow() - s.active.t0 > ACTIVE_TIMEOUT_MS ||
    !marksClose(s.active, kind, itemId, marks.fields)
  ) {
    return
  }
  const closing: Closing = {
    measure: s.active,
    marks,
    committedAt: perfNow(),
    paintedAt: null,
    domNodes: document.getElementsByTagName('*').length,
    timer: null,
  }
  s.active = null
  s.closing = closing
  requestAnimationFrame(() => {
    closing.paintedAt = perfNow()
    closing.timer = setTimeout(() => finalize(s, closing), SETTLE_MS)
  })
}

// 控えた resource entry から、条件に合う最後の物を待って返す (同期の計時)。
// 受信完了の後に非同期で届くので、少しの間だけ待つ
export async function awaitResource(
  match: (entry: ResourceLike) => boolean,
): Promise<ResourceLike | null> {
  const s = current()
  if (!s) {
    return null
  }
  const deadline = perfNow() + RESOURCE_WAIT_MS
  for (;;) {
    const hit = s.resources.findLast(match)
    if (hit !== undefined || perfNow() >= deadline) {
      return hit ?? null
    }
    await new Promise((resolve) => setTimeout(resolve, RESOURCE_POLL_MS))
  }
}

function toResource(entry: PerformanceEntry): ResourceLike {
  const e = entry as PerformanceResourceTiming
  return {
    name: e.name,
    startTime: e.startTime,
    responseStart: e.responseStart,
    responseEnd: e.responseEnd,
    transferSize: e.transferSize,
    decodedBodySize: e.decodedBodySize,
    // iOS 16.4 より前は serverTiming が無い
    serverTiming: Array.isArray(e.serverTiming)
      ? e.serverTiming.map((t) => ({ name: t.name, duration: t.duration }))
      : undefined,
  }
}

// ノートへのリンクを押したら計測を始める。capture で聞くのは、行の
// クリックを止める部品があっても先に拾うため (修飾キー付き = 別タブは除く)
function onClick(event: MouseEvent): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return
  }
  const anchor = (event.target as Element | null)?.closest?.('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) {
    return
  }
  const target = itemLinkTarget(anchor.href, location.origin)
  if (target !== null) {
    perfStart('ノート', target.pathname, target.itemId)
  }
}

function observe(
  type: string,
  onEntries: (entries: PerformanceEntry[]) => void,
): PerformanceObserver | null {
  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes?.includes(type)
  ) {
    return null
  }
  const observer = new PerformanceObserver((list) => onEntries(list.getEntries()))
  observer.observe({ type, buffered: true })
  return observer
}

// 仕掛ける。戻り値を呼ぶと外す (React の効果の後始末)。何度呼んでも 1 重
export function installPerf(): () => void {
  if (current()) {
    return () => {}
  }
  const state: PerfState = {
    active: null,
    closing: null,
    resources: [],
    longTasks: null,
    seenMarks: [],
    teardown: () => {},
  }
  const resourceObserver = observe('resource', (entries) => {
    state.resources.push(...entries.map(toResource))
    trimResources(state)
  })
  // 長いタスクは Chromium だけ。Safari では null のまま (行には「未対応」)
  const longTaskObserver = observe('longtask', (entries) => {
    state.longTasks ??= []
    state.longTasks.push(
      ...entries.map((e) => ({ startTime: e.startTime, duration: e.duration })),
    )
    state.longTasks = state.longTasks.slice(-RESOURCE_KEEP)
  })
  if (longTaskObserver !== null) {
    state.longTasks = []
  }
  document.addEventListener('click', onClick, true)

  state.teardown = () => {
    resourceObserver?.disconnect()
    longTaskObserver?.disconnect()
    document.removeEventListener('click', onClick, true)
    if (state.closing?.timer) {
      clearTimeout(state.closing.timer)
    }
  }
  globalForPerf.qrNotePerfClient = state
  return () => {
    if (globalForPerf.qrNotePerfClient === state) {
      state.teardown()
      globalForPerf.qrNotePerfClient = undefined
    }
  }
}
