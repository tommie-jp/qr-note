// ログの控え (設計は docs/21-ログ表示計画.md / docs/30-ブラウザログ計画.md)。
//
// console.warn / console.error を包み、元の console へ流しつつメモリ上の
// リングバッファに控える。/logs ページ (スマホ) から直近の失敗を見るため。
// 書影・書誌・商品情報の失敗は全部 console.warn/error に集約されているので、
// ここを包めば既存コードを 1 行も変えずに拾える。
//
// ブラウザで起きた失敗は /api/client-logs から pushBrowserLogs() で届く
// (docs/30 §1)。**サーバ用と別のバッファに積む** — 混ぜると多弁な側が
// 寡黙な側を押し流し、クライアントの暴走ループがサーバの肝心の 1 行を消す。
//
// 起動時に instrumentation.ts が installConsoleCapture() を 1 回呼ぶ。

import type { ClientLogItem } from './clientLogPayload'
import { LOG_BUFFER_SIZE, type LogEntry, type LogLevel } from './logEntry'
import { formatLogArgs } from './logText'

export { LOG_BUFFER_SIZE, LOG_TEXT_LIMIT } from './logEntry'
export type { LogEntry, LogLevel, LogSource } from './logEntry'

// バッファと「包んだか」は globalThis に持つ (db.ts と同じ理由)。
// dev のホットリロードでこのモジュールが再評価されても、控えが消えたり
// console が二重に包まれたりしない
interface LogGlobal {
  server: LogEntry[]
  browser: LogEntry[]
  original: { warn: typeof console.warn; error: typeof console.error } | null
}

const globalForLog = globalThis as unknown as { qrNoteLog?: LogGlobal }

function state(): LogGlobal {
  globalForLog.qrNoteLog ??= { server: [], browser: [], original: null }
  return globalForLog.qrNoteLog
}

// 末尾に足し、溢れたぶんを古い順に捨てる
function append(buffer: LogEntry[], entry: LogEntry): void {
  buffer.push(entry)
  if (buffer.length > LOG_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - LOG_BUFFER_SIZE)
  }
}

function push(level: LogLevel, args: unknown[]): void {
  append(state().server, {
    at: Date.now(),
    level,
    text: formatLogArgs(args),
    source: 'server',
  })
}

// console.warn / console.error を包む。何度呼んでも包みは 1 重。
export function installConsoleCapture(): void {
  const s = state()
  if (s.original) {
    return // 包み済み
  }
  s.original = { warn: console.warn, error: console.error }
  console.warn = (...args: unknown[]) => {
    push('warn', args)
    s.original?.warn(...args) // ssh + docker compose logs の一次調査は殺さない
  }
  console.error = (...args: unknown[]) => {
    push('error', args)
    s.original?.error(...args)
  }
}

// 元の console に戻す (テストの後始末用。アプリは外さない)
export function uninstallConsoleCapture(): void {
  const s = state()
  if (!s.original) {
    return
  }
  console.warn = s.original.warn
  console.error = s.original.error
  s.original = null
}

// ブラウザから届いたログを控える (/api/client-logs が呼ぶ)。
// 時刻はここで打つ — クライアントの時計は信じない (docs/30 §1)
export function pushBrowserLogs(items: ClientLogItem[], device: string): void {
  const at = Date.now()
  const { browser } = state()
  for (const item of items) {
    append(browser, { at, level: item.level, text: item.text, source: 'browser', device })
  }
}

// 新しい順で返す (画面は最新が知りたい)。サーバとブラウザを時刻順に混ぜる —
// 「クライアントが失敗した直後にサーバが何を言ったか」は並べて初めて読める
export function recentLogs(): LogEntry[] {
  const s = state()
  // sort は安定なので、同じ時刻なら積んだ順が保たれる。
  // 昇順に並べてから反転させ、新しい順にする
  return [...s.server, ...s.browser].sort((a, b) => a.at - b.at).reverse()
}

export function clearLogBuffer(): void {
  const s = state()
  s.server = []
  s.browser = []
}
