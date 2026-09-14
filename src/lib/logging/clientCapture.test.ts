import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  type CaptureScope,
  flushClientLogs,
  installClientLogCapture,
  pendingClientLogs,
  uninstallClientLogCapture,
} from './clientCapture'
import type { ClientLogItem } from './clientPayload'
import { LOG_TEXT_LIMIT } from './entry'

// ブラウザの拾い手を node のまま試す (docs/30-ブラウザログ計画.md §5)。
// このリポジトリは jsdom を持たない (components/chrome/HeaderMenu.test.tsx と同じ方針) ので、
// window の代わりに偽の scope を渡す。拾い手が window に依存しない作りなのは
// Worker からも同じ install を呼ぶためで、テストのしやすさはその副産物

// 登録されたリスナーを呼べる偽の scope
function fakeScope() {
  const listeners = new Map<string, (event: unknown) => void>()
  const original = {
    warn: vi.fn(),
    error: vi.fn(),
  }
  const scope: CaptureScope = {
    console: { warn: original.warn, error: original.error },
    addEventListener: (type, listener) => {
      listeners.set(type, listener)
    },
    removeEventListener: (type) => {
      listeners.delete(type)
    },
  }
  return {
    scope,
    original,
    emit(type: string, event: unknown) {
      listeners.get(type)?.(event)
    },
    has: (type: string) => listeners.has(type),
  }
}

let sent: ClientLogItem[][]
let host: ReturnType<typeof fakeScope>

function install(options: { send?: (items: ClientLogItem[]) => void } = {}) {
  installClientLogCapture({
    scope: host.scope,
    send: options.send ?? ((items) => sent.push(items)),
    flushIntervalMs: 3000,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  host = fakeScope()
})

afterEach(() => {
  uninstallClientLogCapture()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('warn と error を控え、元の console にも流す', () => {
  install()

  host.scope.console.warn('モデルを読み込めませんでした')
  host.scope.console.error('埋め込みに失敗しました', new Error('HTTP 404'))

  expect(pendingClientLogs()).toEqual([
    { level: 'warn', text: 'モデルを読み込めませんでした' },
    { level: 'error', text: '埋め込みに失敗しました HTTP 404' },
  ])
  // eruda で読むために、ブラウザの console にも残す
  expect(host.original.warn).toHaveBeenCalledTimes(1)
  expect(host.original.error).toHaveBeenCalledTimes(1)
})

test('未捕捉の例外を拾う (console を経由しないので、包むだけでは掛からない)', () => {
  install()

  host.emit('error', {
    message: 'null is not an object',
    filename: 'https://qr.tommie.jp/app.js',
    lineno: 42,
  })

  const [entry] = pendingClientLogs()
  expect(entry.level).toBe('error')
  expect(entry.text).toContain('未捕捉の例外: null is not an object')
  expect(entry.text).toContain('app.js:42')
})

test('誰も catch しなかった Promise を拾う', () => {
  install()

  host.emit('unhandledrejection', { reason: new Error('モデルの取得に失敗') })

  expect(pendingClientLogs()[0]).toEqual({
    level: 'error',
    text: '未処理の Promise 拒否: モデルの取得に失敗',
  })
})

test('1 件は 2000 文字で切る', () => {
  install()

  host.scope.console.warn('あ'.repeat(LOG_TEXT_LIMIT + 100))

  expect(pendingClientLogs()[0].text).toHaveLength(LOG_TEXT_LIMIT)
})

test('送信待ちが 50 件を超えたら古い方から捨てる', () => {
  install()

  for (let i = 0; i < 60; i += 1) {
    host.scope.console.warn(`失敗 ${i}`)
  }

  const pending = pendingClientLogs()
  expect(pending).toHaveLength(50)
  // 新しい失敗のほうが診断に効くので、残るのは後ろの 50 件
  expect(pending[0].text).toBe('失敗 10')
  expect(pending[49].text).toBe('失敗 59')
})

test('一定時間ごとに、1 回 20 件までまとめて送る', () => {
  install()

  for (let i = 0; i < 25; i += 1) {
    host.scope.console.error(`失敗 ${i}`)
  }
  vi.advanceTimersByTime(3000)

  expect(sent).toHaveLength(1)
  expect(sent[0]).toHaveLength(20)
  // 残りは次の回に送る
  expect(pendingClientLogs()).toHaveLength(5)
})

test('ページ離脱では溜めずに送り切る', () => {
  install()

  host.scope.console.error('遷移直前の失敗')
  host.emit('pagehide', {})

  expect(sent).toEqual([[{ level: 'error', text: '遷移直前の失敗' }]])
})

test('送信に失敗しても投げず、console.error も呼ばない (無限ループを作らない)', () => {
  install({
    send: () => {
      throw new Error('オフライン')
    },
  })

  host.scope.console.warn('失敗')
  expect(() => flushClientLogs()).not.toThrow()

  // 送れなかったぶんは捨てる。溜め直すと、繋がらない間に送信待ちが埋まり、
  // その後の新しい失敗を押し出す
  expect(pendingClientLogs()).toHaveLength(0)
  // 「送れない → エラー → 送る」を作らないこと。元の console は 1 回
  // (拾った warn) だけで、送信失敗を error で追加していない
  expect(host.original.error).not.toHaveBeenCalled()
})

test('二重に install しても包みは 1 重のまま', () => {
  install()
  install()

  host.scope.console.warn('失敗')

  expect(pendingClientLogs()).toHaveLength(1)
  expect(host.original.warn).toHaveBeenCalledTimes(1)
})

test('外すと元の console に戻り、リスナーも解除される', () => {
  install()
  uninstallClientLogCapture()

  host.scope.console.warn('外した後の失敗')

  expect(host.scope.console.warn).toBe(host.original.warn)
  expect(host.has('error')).toBe(false)
  expect(pendingClientLogs()).toEqual([])
})
