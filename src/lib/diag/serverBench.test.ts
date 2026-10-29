import { describe, expect, test, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/items/search', () => ({ searchItems: vi.fn() }))
vi.mock('@/lib/offline/syncItems', () => ({ loadOfflineSyncPayload: vi.fn() }))

const { makeNoiseJpeg, median, sampleMedian } = await import('./serverBench')

describe('median', () => {
  test('奇数個は真ん中、偶数個は真ん中 2 つの平均', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  test('空なら NaN (0 と取り違えない)', () => {
    expect(median([])).toBeNaN()
  })
})

describe('sampleMedian', () => {
  test('ならしの 1 回は数えず、計測 3 回の中央値を取る', async () => {
    // Arrange: 1 回目 (ならし) だけ極端に遅い
    const totals = [1000, 30, 10, 20]
    let calls = 0
    const run = async () => {
      const totalMs = totals[calls]
      calls += 1
      return { totalMs, phases: { db: totalMs / 2 }, scale: `${calls} 回目` }
    }

    // Act
    const r = await sampleMedian(run)

    // Assert
    expect(calls).toBe(4)
    expect(r.medianMs).toBe(20)
    expect(r.phases).toEqual({ db: 10 })
    expect(r.scale).toBe('4 回目')
  })

  test('途中で投げたら項目ごと失敗にする (呼ぶ側が failed に積む)', async () => {
    const run = async () => {
      throw new Error('db down')
    }

    await expect(sampleMedian(run)).rejects.toThrow('db down')
  })
})

test('ノイズ画像は毎回同じ中身になる (環境どうしで同じ材料)', async () => {
  const a = await makeNoiseJpeg(64, 48)
  const b = await makeNoiseJpeg(64, 48)

  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  // JPEG の先頭
  expect([...a.slice(0, 2)]).toEqual([0xff, 0xd8])
})

test('検索ページの cookie はペイン構成と表示モードを固定で上書きする', async () => {
  const { pageBenchCookie } = await import('./serverBench')

  const cookie = pageBenchCookie([
    { name: 'qr_session', value: 's1' },
    { name: 'panes', value: '1' },
    { name: 'view', value: 'image' },
  ])

  expect(cookie).toBe('qr_session=s1; panes=3; view=compact')
})

test('自分自身の宛先は standalone の待ち受け (HOSTNAME) に合わせる', async () => {
  const { selfOrigin } = await import('./serverBench')

  expect(selfOrigin({ HOSTNAME: '387119a2fecf' })).toBe('http://387119a2fecf:3000')
  expect(selfOrigin({ HOSTNAME: '0.0.0.0', PORT: '3301' })).toBe('http://127.0.0.1:3301')
  expect(selfOrigin({})).toBe('http://127.0.0.1:3000')
})
