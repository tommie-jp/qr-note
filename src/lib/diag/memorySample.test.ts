import { expect, test } from 'vitest'
import { diffMemory, parseCgroupBytes, takeMemorySnapshot, type MemoryProbe } from './memorySample'

const MB = 1024 * 1024

function probeOf(overrides: Partial<MemoryProbe> = {}): MemoryProbe {
  return {
    memoryUsage: () => ({ rss: 200 * MB, heapUsed: 80 * MB, heapTotal: 120 * MB, external: 20 * MB, arrayBuffers: 5 * MB }),
    // resourceUsage().maxRSS は kB
    maxRssKB: () => 250 * 1024,
    readText: async () => null,
    uptimeSec: () => 12.34,
    ...overrides,
  }
}

test('cgroup の値は数字ならバイト、max や読めなければ null', () => {
  expect(parseCgroupBytes('1677721600\n')).toBe(1677721600)
  expect(parseCgroupBytes('max\n')).toBeNull()
  expect(parseCgroupBytes(null)).toBeNull()
  expect(parseCgroupBytes('abc')).toBeNull()
})

test('スナップショットは MB の小数 1 桁で、cgroup が無ければ null', async () => {
  const snapshot = await takeMemorySnapshot(probeOf())

  expect(snapshot).toEqual({
    rssMB: 200,
    heapUsedMB: 80,
    heapTotalMB: 120,
    externalMB: 20,
    arrayBuffersMB: 5,
    maxRssMB: 250,
    cgroupCurrentMB: null,
    cgroupPeakMB: null,
    uptimeSec: 12,
  })
})

test('cgroup の現在値とピークを読む', async () => {
  const files: Record<string, string> = {
    '/sys/fs/cgroup/memory.current': `${Math.round(512.25 * MB)}\n`,
    '/sys/fs/cgroup/memory.peak': `${900 * MB}\n`,
  }
  const snapshot = await takeMemorySnapshot(probeOf({ readText: async (path) => files[path] ?? null }))

  expect(snapshot.cgroupCurrentMB).toBe(512.3)
  expect(snapshot.cgroupPeakMB).toBe(900)
})

test('前後の差は RSS の前後・ヒープと external の増減・最大 RSS の伸び', async () => {
  const before = await takeMemorySnapshot(probeOf())
  const after = await takeMemorySnapshot(
    probeOf({
      memoryUsage: () => ({ rss: 230 * MB, heapUsed: 70 * MB, heapTotal: 120 * MB, external: 26 * MB, arrayBuffers: 5 * MB }),
      maxRssKB: () => 280 * 1024,
    }),
  )

  expect(diffMemory(before, after)).toEqual({
    rssBeforeMB: 200,
    rssAfterMB: 230,
    heapUsedDeltaMB: -10,
    externalDeltaMB: 6,
    maxRssGrowthMB: 30,
  })
})
