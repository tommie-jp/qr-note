// ブラウザ → サーバへ送るログの形と、その検証 (docs/30-ブラウザログ計画.md §1)。
//
// 送る側 (logging/clientCapture.ts) と受ける側 (/api/client-logs) が同じ定義を見る。
// 受け口では**必ず手で確かめる** — 外から来るデータを信じない (境界での検証)。

import { LOG_TEXT_LIMIT, type LogLevel } from './entry'

export interface ClientLogItem {
  level: LogLevel
  text: string
}

// 1 回の送信で運ぶ件数。エラーが無限ループしても回線とサーバを潰さない
export const CLIENT_LOG_MAX_BATCH = 20

// 送信待ちの上限。溢れたら古い方から捨てる (新しい失敗のほうが診断に効く)
export const CLIENT_LOG_MAX_PENDING = 50

export const CLIENT_LOG_PATH = '/api/client-logs'

const LEVELS: readonly string[] = ['info', 'warn', 'error'] satisfies LogLevel[]

function parseItem(value: unknown): ClientLogItem | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { level, text } = value as { level?: unknown; text?: unknown }
  if (typeof level !== 'string' || !LEVELS.includes(level)) {
    return null
  }
  if (typeof text !== 'string' || text.length === 0) {
    return null
  }
  // 長さは送る側でも切っているが、受ける側でも切る。
  // 送る側は書き換えられる (ブラウザの console から直接叩ける)
  return { level: level as LogLevel, text: text.slice(0, LOG_TEXT_LIMIT) }
}

// 妥当なら項目の配列、そうでなければ null (呼び出し側が 400 を返す)。
// **1 件でも形が違えば全部断る**。部分的に受けると「送ったのに出ない」が
// 起き、ログを見に来た人が原因ではなく仕組みを疑うことになる
export function parseClientLogPayload(body: unknown): ClientLogItem[] | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const { items } = body as { items?: unknown }
  if (!Array.isArray(items) || items.length === 0 || items.length > CLIENT_LOG_MAX_BATCH) {
    return null
  }

  const parsed: ClientLogItem[] = []
  for (const item of items) {
    const one = parseItem(item)
    if (one === null) {
      return null
    }
    parsed.push(one)
  }
  return parsed
}

// User-Agent から端末の印を採る。複数端末で使うので「どの端末の悲鳴か」は要る。
// 詳細な解析はしない — 欲しいのは iPhone か PC かの区別だけで、
// UA の全文を出すと 1 行が長くて一覧が読めなくなる
export function deviceLabel(userAgent: string | null): string {
  if (userAgent === null || userAgent === '') {
    return '不明'
  }
  if (/iPhone/i.test(userAgent)) {
    return 'iPhone'
  }
  if (/iPad/i.test(userAgent)) {
    return 'iPad'
  }
  if (/Android/i.test(userAgent)) {
    return 'Android'
  }
  return 'PC'
}
