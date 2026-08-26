// ブラウザ側でログを拾って送る (docs/30-ブラウザログ計画.md §1)。
//
// iPhone の Safari は Web インスペクタを繋ぐのに Mac が要る。手元 (Windows)
// からは開けないので、クライアントの失敗をサーバへ送って /logs で読む。
//
// 拾うのは 3 つ。**このうち本命は後ろ 2 つ**で、誰も catch しなかった例外は
// console.error を包んだだけでは掛からない。
//   - console.warn / console.error (包む。既存コードは 1 行も変えない)
//   - 'error'              … 未捕捉の例外
//   - 'unhandledrejection' … 誰も catch しなかった Promise
//
// **window に依存させない**。scope を差し替えられるようにしてあるので、
// Worker (self) からも同じ install を呼べる (docs/30 §3。Worker 内の console は
// 別スレッドなので、メインを包んでも eruda を出しても拾えない)。

import {
  CLIENT_LOG_MAX_BATCH,
  CLIENT_LOG_MAX_PENDING,
  type ClientLogItem,
} from './clientLogPayload'
import { LOG_TEXT_LIMIT, type LogLevel } from './logEntry'
import { formatLogArg } from './logText'

type Listener = (event: unknown) => void

// window / DedicatedWorkerGlobalScope の必要なところだけ。
// テストは偽物を渡して node のまま動かす (このリポジトリは jsdom を持たない)
export interface CaptureScope {
  console: {
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
  addEventListener: (type: string, listener: Listener) => void
  removeEventListener: (type: string, listener: Listener) => void
}

export interface ClientLogCaptureOptions {
  scope?: CaptureScope
  // 送信手段。既定は clientLogTransport.ts (Beacon → fetch)。
  // 差し替えられるのはテストのためと、Worker で経路を変えられるようにするため
  send: (items: ClientLogItem[]) => void
  flushIntervalMs?: number
}

// まとめて送るまでの待ち。1 件ごとに送ると、失敗が連鎖したとき要求が殺到する
const DEFAULT_FLUSH_INTERVAL_MS = 3000

interface CaptureState {
  scope: CaptureScope
  original: { warn: CaptureScope['console']['warn']; error: CaptureScope['console']['error'] }
  pending: ClientLogItem[]
  timer: ReturnType<typeof setInterval> | null
  send: (items: ClientLogItem[]) => void
  listeners: [string, Listener][]
}

// globalThis に持つ (logBuffer.ts と同じ理由)。dev の HMR や
// React StrictMode の二重実行でも、包みは 1 重のまま
const globalForCapture = globalThis as unknown as { qrNoteClientLog?: CaptureState }

function current(): CaptureState | undefined {
  return globalForCapture.qrNoteClientLog
}

function record(level: LogLevel, text: string): void {
  const s = current()
  if (!s || text === '') {
    return
  }
  s.pending.push({ level, text: text.slice(0, LOG_TEXT_LIMIT) })
  if (s.pending.length > CLIENT_LOG_MAX_PENDING) {
    // 溢れたら古い方から捨てる。新しい失敗のほうが診断に効く
    s.pending.splice(0, s.pending.length - CLIENT_LOG_MAX_PENDING)
  }
}

// 'error' は ErrorEvent。別オリジンのスクリプトだと message が
// "Script error." になり filename も空だが、それ自体が手掛かりになる
function formatErrorEvent(event: unknown): string {
  const e = event as {
    message?: unknown
    filename?: unknown
    lineno?: unknown
    error?: unknown
  }
  const message =
    typeof e.message === 'string' && e.message !== ''
      ? e.message
      : formatLogArg(e.error)
  const where =
    typeof e.filename === 'string' && e.filename !== ''
      ? ` (${e.filename}:${String(e.lineno ?? '?')})`
      : ''
  return `未捕捉の例外: ${message}${where}`
}

function formatRejectionEvent(event: unknown): string {
  const { reason } = event as { reason?: unknown }
  return `未処理の Promise 拒否: ${formatLogArg(reason)}`
}

// 溜めたぶんを送る。**送信の失敗は握りつぶす** — ここで console.error を
// 呼ぶと「送れない → エラー → 送る」の無限ループになる。失敗しても元の
// console には残っており、その場なら eruda (docs/30 §2) で読める
export function flushClientLogs(): void {
  const s = current()
  if (!s || s.pending.length === 0) {
    return
  }
  const items = s.pending.splice(0, CLIENT_LOG_MAX_BATCH)
  try {
    s.send(items)
  } catch {
    // 送れなかったぶんは捨てる (再送しない)。溜め直すと、繋がらない間
    // 送信待ちが上限まで埋まり、その後の新しい失敗を押し出す
  }
}

// 何度呼んでも包みは 1 重。
export function installClientLogCapture(options: ClientLogCaptureOptions): void {
  if (current()) {
    return // 包み済み
  }

  const scope = options.scope ?? (globalThis as unknown as CaptureScope)
  const state: CaptureState = {
    scope,
    original: { warn: scope.console.warn, error: scope.console.error },
    pending: [],
    timer: null,
    send: options.send,
    listeners: [],
  }
  globalForCapture.qrNoteClientLog = state

  scope.console.warn = (...args: unknown[]) => {
    record('warn', args.map(formatLogArg).join(' '))
    state.original.warn(...args) // ブラウザの console にも残す (eruda で読む)
  }
  scope.console.error = (...args: unknown[]) => {
    record('error', args.map(formatLogArg).join(' '))
    state.original.error(...args)
  }

  const listen = (type: string, listener: Listener) => {
    state.listeners.push([type, listener])
    scope.addEventListener(type, listener)
  }
  listen('error', (event) => record('error', formatErrorEvent(event)))
  listen('unhandledrejection', (event) => record('error', formatRejectionEvent(event)))
  // 遷移直前のエラーが一番失いたくない。'pagehide' は Worker には無いが、
  // 登録しても呼ばれないだけで害はない
  listen('pagehide', () => flushClientLogs())

  state.timer = setInterval(flushClientLogs, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS)
}

// 元に戻す (テストの後始末用。アプリは外さない)
export function uninstallClientLogCapture(): void {
  const s = current()
  if (!s) {
    return
  }
  s.scope.console.warn = s.original.warn
  s.scope.console.error = s.original.error
  for (const [type, listener] of s.listeners) {
    s.scope.removeEventListener(type, listener)
  }
  if (s.timer !== null) {
    clearInterval(s.timer)
  }
  globalForCapture.qrNoteClientLog = undefined
}

// 送信待ち (テスト用)
export function pendingClientLogs(): ClientLogItem[] {
  return [...(current()?.pending ?? [])]
}
