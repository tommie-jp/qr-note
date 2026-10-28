import { describe, expect, test } from 'vitest'
import {
  formatAbortedLine,
  formatNavLine,
  formatTransfer,
  itemLinkTarget,
  marksClose,
  pickActionResponse,
  pickRsc,
  serverTimingSummary,
  sumLongTasks,
  type ResourceLike,
} from './perf'

function rsc(path: string, startTime: number, decodedBodySize: number): ResourceLike {
  return {
    name: `http://localhost${path}${path.includes('?') ? '&' : '?'}_rsc=abc`,
    startTime,
    responseStart: startTime + 50,
    responseEnd: startTime + 150,
    transferSize: decodedBodySize / 4,
    decodedBodySize,
  }
}

describe('pickRsc', () => {
  test('行き先のパスでいちばん大きい要求を本体、残りを prefetch と数える', () => {
    const entries = [
      rsc('/?q=a', 100, 200_000),
      rsc('/?q=%23tag', 120, 3_000), // タグリンクの prefetch (同じ /)
      rsc('/item/1', 130, 5_000),
      rsc('/item/2', 140, 5_000),
    ]
    const picked = pickRsc(entries, { t0: 90, until: 1000, pathname: '/' })
    expect(picked.main?.decodedBodySize).toBe(200_000)
    expect(picked.prefetch).toBe(3)
  })

  test('窓の外と RSC でない要求は数えない', () => {
    const entries: ResourceLike[] = [
      rsc('/?q=old', 10, 9_000),
      { ...rsc('/', 100, 1), name: 'http://localhost/_next/static/a.js' },
      rsc('/?q=a', 100, 2_000),
    ]
    const picked = pickRsc(entries, { t0: 50, until: 1000, pathname: '/' })
    expect(picked.main?.name).toContain('q=a')
    expect(picked.prefetch).toBe(0)
  })

  test('行き先の要求が無ければ main は null', () => {
    expect(pickRsc([rsc('/item/1', 100, 1)], { t0: 0, until: 1000, pathname: '/' })).toEqual({
      main: null,
      prefetch: 1,
    })
  })
})

describe('pickActionResponse (Server Action の応答)', () => {
  const post = (path: string, startTime: number, decodedBodySize: number): ResourceLike => ({
    name: `http://localhost${path}`,
    startTime,
    responseStart: startTime + 40,
    responseEnd: startTime + 90,
    transferSize: decodedBodySize / 4,
    decodedBodySize,
  })

  test('窓の中で行き先のパスに向かう _rsc なしの要求のうち最大を本体にする', () => {
    const entries = [
      post('/', 100, 90_000), // Action の POST
      post('/', 100, 400), // 別の小さな POST
      rsc('/?q=a', 110, 3_000), // 先読み (_rsc あり) は本体にしない
    ]
    const picked = pickActionResponse(entries, { t0: 90, until: 1000, pathname: '/' })
    expect(picked.main?.decodedBodySize).toBe(90_000)
    expect(picked.prefetch).toBe(1)
  })

  test('静的な資源や窓の外は数えない', () => {
    const entries = [
      { ...post('/', 100, 1), name: 'http://localhost/_next/static/chunks/a.js' },
      post('/', 10, 50_000), // 窓の前
    ]
    const picked = pickActionResponse(entries, { t0: 50, until: 1000, pathname: '/' })
    expect(picked.main).toBeNull()
    expect(picked.prefetch).toBe(0)
  })
})

describe('小さな整形', () => {
  test('長いタスクは窓の中だけ数える', () => {
    const tasks = [
      { startTime: 5, duration: 100 },
      { startTime: 20, duration: 60 },
      { startTime: 50, duration: 70 },
    ]
    expect(sumLongTasks(tasks, 10, 40)).toEqual({ count: 1, ms: 60 })
  })

  test('Server-Timing を畳む。無ければ null', () => {
    expect(
      serverTimingSummary({ ...rsc('/', 0, 1), serverTiming: [{ name: 'db', duration: 40.4 }] }),
    ).toBe('db=40')
    expect(serverTimingSummary(rsc('/', 0, 1))).toBeNull()
    expect(serverTimingSummary(null)).toBeNull()
  })

  test('転送量の 0 は ? と書く (0KB は何も運ばなかったに読める)', () => {
    expect(formatTransfer({ ...rsc('/', 0, 4096), transferSize: 0 })).toBe('?/4KB')
    expect(formatTransfer(rsc('/', 0, 4096))).toBe('1KB/4KB')
    expect(formatTransfer(null)).toBeNull()
  })
})

describe('formatNavLine', () => {
  test('サーバの項目 → 時間 → 量 → 裏の通信 → DOM → サーバの順に並ぶ', () => {
    const main = rsc('/?q=a', 110, 102_400)
    const line = formatNavLine(
      { kind: '検索', t0: 100, pathname: '/' },
      { fields: [['q', '"a"']], server: '23ms(検索=3)' },
      {
        committedAt: 300,
        paintedAt: 320,
        rsc: { main, prefetch: 4 },
        domNodes: 812,
        longTasks: { count: 1, ms: 60 },
      },
    )
    expect(line).toBe(
      '[計測] 検索 q="a" 全体=220ms 要求=10ms 応答開始=50ms 受信=100ms 描画=40ms ' +
        'RSC=25KB/100KB prefetch=4 DOM=812 長タスク=1/60ms サーバ=23ms(検索=3)',
    )
  })

  test('本体が見つからなければ時間は未了、長いタスクが測れなければ未対応', () => {
    const line = formatNavLine(
      { kind: 'ノート', t0: 0, pathname: '/item/1', itemId: '1' },
      { fields: [], server: '5ms' },
      { committedAt: 10, paintedAt: 20, rsc: { main: null, prefetch: 0 }, domNodes: 1, longTasks: null },
    )
    expect(line).toContain('要求=未了 応答開始=未了 受信=未了 描画=未了 RSC=未了')
    expect(line).toContain('長タスク=未対応')
  })

  test('表示モードの切替は、押した側の項目 (何から何へ) を行の先頭に載せる', () => {
    const line = formatNavLine(
      { kind: '表示', t0: 0, pathname: '/', extra: [['切替', 'compact→card']] },
      { fields: [['q', '"a"']], server: '9ms' },
      { committedAt: 90, paintedAt: 100, rsc: { main: null, prefetch: 0 }, domNodes: 5, longTasks: null },
    )
    expect(line).toMatch(/^\[計測\] 表示 切替=compact→card q="a" 全体=100ms /)
  })

  test('閉じる前に次が始まったら中断として残す', () => {
    expect(formatAbortedLine({ kind: '検索', t0: 100, pathname: '/' }, 450)).toBe(
      '[計測] 検索 結果=中断 全体=350ms',
    )
  })
})

describe('marksClose', () => {
  test('検索の印は検索と追加読み込みを閉じる', () => {
    expect(marksClose({ kind: '検索', t0: 0, pathname: '/' }, '検索', undefined)).toBe(true)
    expect(marksClose({ kind: '追加', t0: 0, pathname: '/' }, '検索', undefined)).toBe(true)
    expect(marksClose({ kind: 'ノート', t0: 0, pathname: '/item/1', itemId: '1' }, '検索', undefined)).toBe(false)
  })

  test('検索の印は表示モードの切替も閉じる (切替は一覧を描き直す)', () => {
    expect(marksClose({ kind: '表示', t0: 0, pathname: '/' }, '検索', undefined)).toBe(true)
  })

  test('ノートの印は同じノートの計測だけを閉じる (3 ペインの先頭ノートに横取りさせない)', () => {
    const measure = { kind: 'ノート' as const, t0: 0, pathname: '/item/a', itemId: 'a' }
    expect(marksClose(measure, 'ノート', 'a')).toBe(true)
    expect(marksClose(measure, 'ノート', 'b')).toBe(false)
    expect(marksClose({ kind: '検索', t0: 0, pathname: '/' }, 'ノート', 'a')).toBe(false)
  })
})

describe('itemLinkTarget', () => {
  test('同じオリジンの /item/<id> だけを拾う', () => {
    expect(itemLinkTarget('http://localhost/item/019a?q=x', 'http://localhost')).toEqual({
      pathname: '/item/019a',
      itemId: '019a',
    })
    expect(itemLinkTarget('http://localhost/edit/019a', 'http://localhost')).toBeNull()
    expect(itemLinkTarget('https://example.com/item/1', 'http://localhost')).toBeNull()
    expect(itemLinkTarget('not a url', 'http://localhost')).toBeNull()
  })
})
