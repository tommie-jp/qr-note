// ノートの遷移の確かめ (lib/logging/perfNavCheck.ts) の DOM の手足
// (docs/123 §12-6)。計測テスト (PerfTestRunner) が組んで渡す。
//
// 押すのは利用者と同じ入口 (釦・リンクの click、履歴の back / forward、
// 引っ張って更新は touch の合成)。判定に要る様子は DOM と Resource Timing から読む
import 'client-only'
import type { NavCheckDeps, NavSnapshot } from '@/lib/logging/perfNavCheck'
import type { PerfField } from '@/lib/logging/perfLine'

const RSC_MARK = '_rsc='
// 端末で開いた・横取りしたノートの器 (PreviewPane が付ける印)。自動で選んだ
// 先頭ノートの器 (source=auto) は数えない
const DETAIL_PANE = 'section[data-note-pane][data-pane-source="detail"]'
const SEARCH_RESULTS = '[data-search-results]'
const RESULTS_SCROLL = '[data-results-scroll]'
const PANE_BUTTON = 'button[name="panes"]'
const VIEW_BUTTON = 'button[aria-label^="表示:"]'
// 引っ張って更新の合成。閾値は 64px × 抵抗 0.5 なので 128px より長く引く
const PULL_DISTANCE_PX = 200
const PULL_MOVES = 10
const PULL_START_Y = 160
const PULL_MOVE_MS = 16

interface SeenRequest {
  path: string
  isRsc: boolean
  startTime: number
}

function pathOf(url: string): string {
  try {
    return new URL(url, location.href).pathname
  } catch {
    return ''
  }
}

function snapshot(): NavSnapshot {
  return {
    path: location.pathname,
    noteId: document.querySelector(DETAIL_PANE)?.getAttribute('data-item-id') ?? null,
    hasList: document.querySelector(SEARCH_RESULTS) !== null,
    panes: document.querySelector('[data-panes]')?.getAttribute('data-panes') ?? '',
    scrollY: Math.round(window.scrollY),
  }
}

function clickIn(root: ParentNode | null, selector: string, text?: string): boolean {
  const candidates = Array.from(root?.querySelectorAll<HTMLElement>(selector) ?? [])
  const target = text === undefined ? candidates[0] : candidates.find((el) => el.textContent?.includes(text))
  if (target === undefined) {
    return false
  }
  target.click()
  return true
}

function touchAt(target: Element, x: number, y: number): Touch {
  return new Touch({ identifier: 1, target, clientX: x, clientY: y })
}

function fireTouch(target: Element, type: string, touch: Touch, active: boolean): void {
  target.dispatchEvent(
    new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: active ? [touch] : [],
      targetTouches: active ? [touch] : [],
      changedTouches: [touch],
    }),
  )
}

// 一覧を先頭へ戻し、一覧の行の上で下へ引く (PullToRefresh と同じ入口)。
// タッチ端末でなければ PullToRefresh 自体が働かないので false
async function pullToRefresh(sleep: (ms: number) => Promise<void>): Promise<boolean> {
  if (
    !window.matchMedia?.('(pointer: coarse)').matches ||
    typeof Touch === 'undefined' ||
    typeof TouchEvent === 'undefined'
  ) {
    return false
  }
  const scroller = document.querySelector<HTMLElement>(RESULTS_SCROLL)
  if (scroller !== null && scroller.scrollHeight > scroller.clientHeight) {
    scroller.scrollTo({ top: 0 })
  } else {
    window.scrollTo({ top: 0 })
  }
  await sleep(PULL_MOVE_MS * 4)
  const target = document.querySelector(`${SEARCH_RESULTS} li`) ?? document.querySelector(SEARCH_RESULTS)
  if (target === null) {
    return false
  }
  const x = Math.round(window.innerWidth / 2)
  let touch = touchAt(target, x, PULL_START_Y)
  fireTouch(target, 'touchstart', touch, true)
  for (let i = 1; i <= PULL_MOVES; i += 1) {
    await sleep(PULL_MOVE_MS)
    touch = touchAt(target, x, PULL_START_Y + (PULL_DISTANCE_PX * i) / PULL_MOVES)
    fireTouch(target, 'touchmove', touch, true)
  }
  fireTouch(target, 'touchend', touch, false)
  return true
}

function scrollListBy(dy: number): void {
  const scroller = document.querySelector<HTMLElement>(RESULTS_SCROLL)
  if (scroller !== null && scroller.scrollHeight > scroller.clientHeight) {
    scroller.scrollBy({ top: dy })
  } else {
    window.scrollBy({ top: dy })
  }
}

// 手足を組む。戻り値の dispose で Resource Timing の観測を外す。
// 観測は PerformanceObserver で取る (getEntriesByType は既定 250 件で満杯になり、
// 長い計測の後半の要求が載らない)
export function createNavCheckDeps(input: {
  sleep: (ms: number) => Promise<void>
  openNote: (index: number) => boolean
  typeQuery: (query: string) => Promise<void>
  send: (kind: string, fields: readonly PerfField[]) => void
}): { deps: NavCheckDeps; dispose: () => void } {
  const seen: SeenRequest[] = []
  let observer: PerformanceObserver | null = null
  if (typeof PerformanceObserver !== 'undefined') {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        seen.push({ path: pathOf(entry.name), isRsc: entry.name.includes(RSC_MARK), startTime: entry.startTime })
      }
    })
    observer.observe({ type: 'resource', buffered: false })
  }
  const count = (path: string, t0: number, rsc: boolean): number =>
    seen.filter((r) => r.isRsc === rsc && r.path === path && r.startTime >= t0).length

  const deps: NavCheckDeps = {
    sleep: input.sleep,
    now: () => performance.now(),
    snapshot,
    rscSince: (path, t0) => count(path, t0, true),
    apiSince: (path, t0) => count(path, t0, false),
    back: () => history.back(),
    forward: () => history.forward(),
    clickNext: () => clickIn(document.querySelector(DETAIL_PANE), 'a[data-client-note]', '次'),
    pressPaneButton: () => clickIn(document, PANE_BUTTON),
    pressViewButton: () => clickIn(document, VIEW_BUTTON),
    pullToRefresh: () => pullToRefresh(input.sleep),
    clickClose: () => clickIn(document.querySelector(DETAIL_PANE), 'button', '閉じる'),
    openNote: input.openNote,
    typeQuery: input.typeQuery,
    scrollListBy,
    send: input.send,
  }
  return { deps, dispose: () => observer?.disconnect() }
}
