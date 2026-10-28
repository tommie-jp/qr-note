// ブラウザ側の速度計測の純関数 (docs/119-速度計測ログ計画.md §3)。
//
// resource timing の選り分けと、計測 1 回ぶんの行の組み立て。状態は
// logging/perfClient.ts が持ち、ここは入力 (entry の配列・時刻) から答えを
// 返すだけにする — ブラウザの API を偽物で差し替えずにテストできる。

import { formatPerfLine, perfKB, perfMs, type PerfField } from './perfLine'

// PerformanceResourceTiming のうち使う所だけ。外から来る形は信じない
export interface ResourceLike {
  name: string
  startTime: number
  responseStart: number
  responseEnd: number
  transferSize?: number
  decodedBodySize?: number
  serverTiming?: readonly { name: string; duration: number }[]
}

export interface LongTaskLike {
  startTime: number
  duration: number
}

// App Router の RSC 要求は URL に `_rsc=` が付く (打鍵の replace も prefetch も)
const RSC_MARK = '_rsc='

function pathnameOf(url: string): string | null {
  try {
    return new URL(url, 'http://localhost').pathname
  } catch {
    return null
  }
}

export interface RscPick {
  // 画面を差し替えた本体の要求。見つからなければ null
  main: ResourceLike | null
  // 同じ窓の残りの RSC 要求の数 (= 裏で走った prefetch)
  prefetch: number
}

// 窓 [t0, until] に始まった RSC 要求から、本体と prefetch を分ける。
//
// **本体は「行き先と同じパスで、いちばん大きい物」**。行のタグのリンク
// (`/?q=%23…`) も検索と同じ `/` を prefetch するが、prefetch で届くのは
// loading 境界までで小さい。行き先のパスで絞ってから大きさで選べば取り違えない
export function pickRsc(
  entries: readonly ResourceLike[],
  { t0, until, pathname }: { t0: number; until: number; pathname: string },
): RscPick {
  const inWindow = entries.filter(
    (e) => e.name.includes(RSC_MARK) && e.startTime >= t0 && e.startTime <= until,
  )
  let main: ResourceLike | null = null
  for (const entry of inWindow) {
    if (pathnameOf(entry.name) !== pathname) {
      continue
    }
    if (main === null || (entry.decodedBodySize ?? 0) > (main.decodedBodySize ?? 0)) {
      main = entry
    }
  }
  return { main, prefetch: inWindow.length - (main === null ? 0 : 1) }
}

// Server Action の応答を本体とみなして選ぶ (表示モードの切替用。docs/120 §2)。
//
// Action は POST で、URL に `_rsc=` を持たない (pickRsc では拾えない)。一覧を
// 描き直した結果もこの応答に載って返る。resource timing はメソッドを持たない
// ので、窓の中で行き先のパス (クエリ無し) に向かう `_rsc` なしの要求のうち、
// いちばん大きい物を本体にする。_next の静的資源 (JS・CSS) は除く。
// prefetch は窓の中の `_rsc` あり要求の数 (pickRsc と同じ意味)
export function pickActionResponse(
  entries: readonly ResourceLike[],
  { t0, until, pathname }: { t0: number; until: number; pathname: string },
): RscPick {
  const inWindow = entries.filter((e) => e.startTime >= t0 && e.startTime <= until)
  let main: ResourceLike | null = null
  for (const entry of inWindow) {
    if (entry.name.includes(RSC_MARK) || entry.name.includes('/_next/')) {
      continue
    }
    if (pathnameOf(entry.name) !== pathname) {
      continue
    }
    if (main === null || (entry.decodedBodySize ?? 0) > (main.decodedBodySize ?? 0)) {
      main = entry
    }
  }
  const prefetch = inWindow.filter((e) => e.name.includes(RSC_MARK)).length
  return { main, prefetch }
}

// 表示モードの切替の本体。押した瞬間に描き替える形 (docs/118 §10 案 B) では、
// cookie を PUT で書いた後の router.refresh() が _rsc 付きの GET で描き直しを
// 運ぶ。古い画面 (配布前に開いていた) や受け皿の Server Action の経路では
// POST の応答が運ぶので、RSC が見つからなければそちらを探す
export function pickViewSwitch(
  entries: readonly ResourceLike[],
  window: { t0: number; until: number; pathname: string },
): RscPick {
  const rscPick = pickRsc(entries, window)
  return rscPick.main !== null ? rscPick : pickActionResponse(entries, window)
}

// 窓 [t0, t1] に始まった長いタスクの本数と合計 (Chromium だけが持つ)
export function sumLongTasks(
  tasks: readonly LongTaskLike[],
  t0: number,
  t1: number,
): { count: number; ms: number } {
  const hit = tasks.filter((t) => t.startTime >= t0 && t.startTime <= t1)
  return { count: hit.length, ms: hit.reduce((sum, t) => sum + t.duration, 0) }
}

// Server-Timing を `db=40 json=90` に畳む。無ければ null
export function serverTimingSummary(entry: ResourceLike | null): string | null {
  const timings = entry?.serverTiming ?? []
  if (timings.length === 0) {
    return null
  }
  return timings.map((t) => `${t.name}=${Math.round(t.duration)}`).join(' ')
}

// 転送量。transferSize の 0 は「HTTP キャッシュか Service Worker が返した」か
// 「別オリジンで隠された」で、0KB と書くと「何も運ばなかった」に読めるので ? にする
export function formatTransfer(entry: ResourceLike | null): string | null {
  if (entry === null) {
    return null
  }
  const transfer = entry.transferSize ? perfKB(entry.transferSize) : '?'
  return `${transfer}/${perfKB(entry.decodedBodySize ?? null)}`
}

// 表示 … 表示モード (小・中・大・画像) の切替。一覧を描き直すので、閉じる印は
// 検索と同じ (docs/120 §2)
export type NavKind = '検索' | '追加' | 'ノート' | '表示'

// 画面遷移 1 回ぶんの計測
export interface NavMeasure {
  kind: NavKind
  // 開始 (打鍵の確定・行のクリック)。performance.now() の時刻
  t0: number
  // 行き先のパス (本体の RSC 要求を見分ける)
  pathname: string
  // ノートのときだけ。届いた印 (PerfMarks) と突き合わせる
  itemId?: string
  // 押した側が知っている項目 (表示の切替の「何から何へ」)。行の先頭に並べる
  extra?: readonly PerfField[]
}

// 届いた印 (PerfMarks) が運んでくるサーバ側の値
export interface ServerMarks {
  // サーバが知っている項目 (q・panes・件数・本文の大きさ…)。行の先頭に並べる
  fields: readonly PerfField[]
  // サーバの段階の要約 (`23ms(検索=3 …)`)
  server: string
}

export interface NavObservation {
  // 印が届いた (React が描き終えた) 時刻
  committedAt: number
  // その次のフレーム (画面に出た) 時刻
  paintedAt: number
  rsc: RscPick
  domNodes: number
  // 長いタスクが測れない環境 (Safari) では null
  longTasks: { count: number; ms: number } | null
}

function diff(to: number | undefined, from: number | undefined): number | null {
  return to === undefined || from === undefined || to <= 0 ? null : to - from
}

// 行の並び: サーバの項目 → 全体 → 要求 → 応答開始 → 受信 → 描画 → 量 → 裏の通信 → DOM → サーバ。
// 左から右へ時間の流れ順 (§1-1)。
//
// 描画 (印が届いた時刻 − 本体の受信完了) が負になるのは、本体の受信が終わる
// 前に React が描き始めた (ストリームの途中で差し替えた) とき。丸めずに出す
export function formatNavLine(
  measure: NavMeasure,
  marks: ServerMarks,
  obs: NavObservation,
): string {
  const { main } = obs.rsc
  return formatPerfLine(measure.kind, [
    ...(measure.extra ?? []),
    ...marks.fields,
    ['全体', perfMs(obs.paintedAt - measure.t0)],
    ['要求', main ? perfMs(main.startTime - measure.t0) : '未了'],
    ['応答開始', perfMs(diff(main?.responseStart, main?.startTime))],
    ['受信', perfMs(diff(main?.responseEnd, main?.responseStart))],
    ['描画', main ? perfMs(obs.committedAt - main.responseEnd) : '未了'],
    ['RSC', formatTransfer(main) ?? '未了'],
    ['prefetch', obs.rsc.prefetch],
    ['DOM', obs.domNodes],
    ['長タスク', obs.longTasks ? `${obs.longTasks.count}/${perfMs(obs.longTasks.ms)}` : '未対応'],
    ['サーバ', marks.server],
  ])
}

// 印が届く前に次の操作が始まった (打ち直し・押し直し)。**黙って捨てない** —
// 遅いときほど記録が残らない形になる (起動計測で踏んだ罠。bootTiming.ts)
export function formatAbortedLine(measure: NavMeasure, now: number): string {
  return formatPerfLine(measure.kind, [
    ['結果', '中断'],
    ['全体', perfMs(now - measure.t0)],
  ])
}

// 印 (PerfMarks) が今の計測を閉じてよいか。
// 検索の印は検索・追加読み込みを閉じる (どちらも同じ HomeResults が描く)。
// ノートの印は同じノートの計測だけを閉じる — 3 ペインの先頭ノート (自動) の
// 印が、押したノートの計測を横取りしないように
export function marksClose(
  measure: NavMeasure,
  kind: '検索' | 'ノート',
  itemId: string | undefined,
): boolean {
  if (kind === '検索') {
    return measure.kind === '検索' || measure.kind === '追加' || measure.kind === '表示'
  }
  return measure.kind === 'ノート' && measure.itemId === itemId
}

// ノートへのリンクなら、そのパスと id。他は null。
// href は a 要素の解決済みの値 (絶対 URL) を渡す
export function itemLinkTarget(
  href: string,
  origin: string,
): { pathname: string; itemId: string } | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.origin !== origin) {
    return null
  }
  const match = /^\/item\/([^/]+)$/.exec(url.pathname)
  return match ? { pathname: url.pathname, itemId: decodeURIComponent(match[1]) } : null
}
