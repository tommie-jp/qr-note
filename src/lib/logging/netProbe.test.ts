import { expect, test } from 'vitest'
import { DOWNLOAD_BYTES, formatMbps, measureNet, type NetProbeDeps, toMbps } from './netProbe'

// 撃った URL ごとに決まった時間で応える偽の回線
function fakeNet(costMs: (url: string, init?: RequestInit) => number, receive: (url: string) => number | null = () => null) {
  let clock = 0
  const urls: string[] = []
  const deps: NetProbeDeps = {
    now: () => clock,
    fetch: async (url, init) => {
      urls.push(`${init?.method ?? 'GET'} ${url}`)
      clock += costMs(url, init)
      return new Response(new Uint8Array(0))
    },
    receiveMs: receive,
  }
  return { deps, urls }
}

test('往復 5 回・下り 3 回・上り 3 回を撃ち、回ごとに URL を変える', async () => {
  const { deps, urls } = fakeNet(() => 10)

  await measureNet(deps, new Uint8Array(4))

  expect(urls.filter((u) => u.includes('size=0'))).toHaveLength(5)
  expect(urls.filter((u) => u.includes(`size=${DOWNLOAD_BYTES}`))).toHaveLength(3)
  expect(urls.filter((u) => u.startsWith('POST'))).toHaveLength(3)
  expect(new Set(urls).size).toBe(urls.length)
})

test('下りは受信時間 (Resource Timing)、上りは全体 − 往復で Mbps にする', async () => {
  // Arrange: 往復 20ms、下りは受信 160ms、上りは全体 100ms
  const { deps } = fakeNet(
    (url, init) => (init?.method === 'POST' ? 100 : url.includes('size=0') ? 20 : 200),
    (url) => (url.includes(`size=${DOWNLOAD_BYTES}`) ? 160 : null),
  )

  // Act
  const fields = await measureNet(deps, new Uint8Array(4))

  // Assert: 2MiB を 160ms → 104.9Mbps、1MiB を 80ms → 104.9Mbps
  expect(fields).toEqual([
    ['RTT', '20ms'],
    ['下り', '105Mbps'],
    ['上り', '105Mbps'],
  ])
})

test('Resource Timing が読めなければ下りも全体 − 往復で代える', async () => {
  const { deps } = fakeNet((url) => (url.includes('size=0') ? 20 : 180))

  const fields = await measureNet(deps, new Uint8Array(4))

  expect(fields[1]).toEqual(['下り', '105Mbps'])
})

test('失敗した応答は投げる (呼ぶ側が「失敗」の行にする)', async () => {
  const deps: NetProbeDeps = {
    now: () => 0,
    fetch: async () => new Response('no', { status: 503 }),
    receiveMs: () => null,
  }

  await expect(measureNet(deps, new Uint8Array(4))).rejects.toThrow('HTTP 503')
})

test('Mbps の表記は 10 未満だけ小数 1 桁', () => {
  expect(toMbps(1_000_000, 1000)).toBe(8)
  expect(formatMbps(8)).toBe('8.0Mbps')
  expect(formatMbps(85.4)).toBe('85Mbps')
})
