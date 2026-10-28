import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  clearLogBuffer,
  installConsoleCapture,
  LOG_BUFFER_SIZE,
  LOG_TEXT_LIMIT,
  pushBrowserLogs,
  recentLogs,
  uninstallConsoleCapture,
} from './buffer'

// 本物の console を包むテストなので、出力が試験の画面を汚さないよう
// 「元の console」を先に黙らせてから包む
let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  installConsoleCapture()
})

afterEach(() => {
  uninstallConsoleCapture()
  clearLogBuffer()
  vi.restoreAllMocks()
})

test('warn と error を控え、元の console にも流す', () => {
  console.warn('書影を取得できませんでした')
  console.error('書影を保存できませんでした')

  const logs = recentLogs()
  expect(logs).toHaveLength(2)
  // 新しい順 (画面は最新が知りたい)
  expect(logs[0].level).toBe('error')
  expect(logs[0].text).toContain('保存できません')
  expect(logs[1].level).toBe('warn')
  // ssh + docker compose logs の一次調査を殺さない
  expect(warnSpy).toHaveBeenCalledTimes(1)
  expect(errorSpy).toHaveBeenCalledTimes(1)
})

test('複数の引数は空白で繋ぎ、Error は message を採る', () => {
  console.warn('openBD から書影を取得できませんでした (isbn=978…)', new Error('HTTP 503'))
  expect(recentLogs()[0].text).toBe(
    'openBD から書影を取得できませんでした (isbn=978…) HTTP 503',
  )
})

test('オブジェクトは JSON にする。文字列化に失敗しても拾う側は落ちない', () => {
  console.warn('応答:', { count: 0 })
  expect(recentLogs()[0].text).toBe('応答: {"count":0}')

  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic // JSON.stringify が投げる
  console.warn('循環:', cyclic)
  expect(recentLogs()[0].text).toContain('循環:')
})

test('上限を超えたら古いものから捨てる', () => {
  for (let i = 0; i < LOG_BUFFER_SIZE + 10; i += 1) {
    console.warn(`entry-${i}`)
  }
  const logs = recentLogs()
  expect(logs).toHaveLength(LOG_BUFFER_SIZE)
  expect(logs[0].text).toBe(`entry-${LOG_BUFFER_SIZE + 9}`) // 最新は残る
  expect(logs.at(-1)?.text).toBe('entry-10') // 最古の 10 件が消えた
})

test('長すぎる 1 件は切り詰める (バッファをメモリで溢れさせない)', () => {
  console.warn('x'.repeat(LOG_TEXT_LIMIT * 2))
  expect(recentLogs()[0].text.length).toBeLessThanOrEqual(LOG_TEXT_LIMIT)
})

test('二重に install しても包みは 1 重 (dev のホットリロード対策)', () => {
  installConsoleCapture() // beforeEach と合わせて 2 回目
  console.warn('一度だけ')
  expect(recentLogs()).toHaveLength(1)
  expect(warnSpy).toHaveBeenCalledTimes(1) // 元の console にも 1 回だけ
})

test('uninstall で元の console に戻る (テストの後始末)', () => {
  uninstallConsoleCapture()
  console.warn('包みが外れた後')
  expect(recentLogs()).toHaveLength(0)
})

// --- ブラウザから届いたログ (docs/30-ブラウザログ計画.md §1) ---

test('ブラウザのログは source と端末の印を持つ', () => {
  pushBrowserLogs([{ level: 'error', text: 'モデルを読み込めませんでした' }], 'iPhone')

  const [entry] = recentLogs()
  expect(entry.source).toBe('browser')
  expect(entry.device).toBe('iPhone')
  expect(entry.text).toBe('モデルを読み込めませんでした')
})

test('サーバとブラウザは時刻順に混ざる', () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-07-19T00:00:00.000Z'))
    console.warn('サーバの警告')
    vi.setSystemTime(new Date('2026-07-19T00:00:01.000Z'))
    pushBrowserLogs([{ level: 'error', text: 'ブラウザの失敗' }], 'iPhone')

    // 新しい順。「クライアントが失敗した直後にサーバが何を言ったか」を
    // 並べて読めることが要点
    expect(recentLogs().map((log) => log.text)).toEqual([
      'ブラウザの失敗',
      'サーバの警告',
    ])
  } finally {
    vi.useRealTimers()
  }
})

test('ブラウザ側が溢れてもサーバ側は押し流されない (バッファが別)', () => {
  console.warn('消えては困るサーバの警告')
  for (let i = 0; i < LOG_BUFFER_SIZE + 10; i += 1) {
    pushBrowserLogs([{ level: 'error', text: `暴走 ${i}` }], 'iPhone')
  }

  const logs = recentLogs()
  expect(logs.filter((log) => log.source === 'browser')).toHaveLength(LOG_BUFFER_SIZE)
  expect(logs.filter((log) => log.source === 'server').map((log) => log.text)).toEqual([
    '消えては困るサーバの警告',
  ])
})

// 速度計測の行 (docs/119 §1-2)。警告・エラーとは別の控え
test('計測行は別の控えに積み、ログの一覧には混ぜない', async () => {
  const { clearPerfLines, pushPerfLine, recentPerfLines } = await import('./buffer')
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

  pushPerfLine('[計測] 検索/サーバ 全体=3ms')
  pushBrowserLogs(
    [
      { level: 'info', text: '[計測] 検索 全体=120ms', kind: 'perf' },
      { level: 'warn', text: '普通の警告' },
    ],
    'iPhone',
  )

  expect(recentLogs().map((log) => log.text)).toEqual(['普通の警告'])
  expect(recentPerfLines().map((line) => [line.source, line.device, line.text])).toEqual([
    ['browser', 'iPhone', '[計測] 検索 全体=120ms'],
    ['server', undefined, '[計測] 検索/サーバ 全体=3ms'],
  ])
  // 200 件を超えた分も docker compose logs で集計できるよう stdout にも出す
  expect(writeSpy).toHaveBeenCalledWith('[計測] 検索/サーバ 全体=3ms\n')

  // 消去はページごと: 警告の消去は計測行を残し、計測の消去は警告を残す
  clearLogBuffer()
  expect(recentLogs()).toEqual([])
  expect(recentPerfLines()).toHaveLength(2)
  pushBrowserLogs([{ level: 'warn', text: '残る警告' }], 'PC')
  clearPerfLines()
  expect(recentPerfLines()).toEqual([])
  expect(recentLogs().map((log) => log.text)).toEqual(['残る警告'])
})
