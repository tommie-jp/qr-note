import { expect, test } from 'vitest'
import { formatBenchCopy, formatMemoryDelta, formatMemoryRound, formatMs, formatPhases } from './formatBench'
import type { ServerBenchResult } from './benchTypes'

const SERVER: ServerBenchResult = {
  version: 1,
  env: {
    cpuModel: 'Intel Core Processor (Broadwell)',
    threads: 3,
    totalMemMB: 2048,
    nodeVersion: 'v26.12.1',
    appVersion: '0.23.83',
    items: 1148,
    circuitItems: 583,
    measuredAt: '2026-10-29T05:00:00.000Z',
  },
  items: [
    { id: 'parse:fixture', label: '見本', medianMs: 61.25, scale: '10 件・50 図', phases: { sha1: 0.1, 解析: 55, 抽出: 6.1 }, fixed: true },
    { id: 'search:抵抗', label: '検索', medianMs: 123.4, scale: '20/48 件', phases: {}, fixed: false },
  ],
  failed: [{ id: 'thumb:fixture', message: 'sharp missing' }],
}

test('100ms 未満は小数 1 桁、以上は整数', () => {
  expect(formatMs(6.14)).toBe('6.1ms')
  expect(formatMs(123.4)).toBe('123ms')
  expect(formatPhases({ sha1: 0.1, 解析: 55 })).toBe('sha1=0.1ms 解析=55.0ms')
})

test('コピーは 1 行 1 項目で、環境 → CPU → サーバ → 端末の順', () => {
  const text = formatBenchCopy({ cpu: 'シングル 3620 MIPS', server: SERVER, clients: [] })

  expect(text.split('\n')).toEqual([
    '## QR-Note ベンチマーク',
    '環境.CPU=Intel Core Processor (Broadwell) (3 スレッド)',
    '環境.メモリ=2048MB',
    '環境.版=QR-Note 0.23.83 / Node.js v26.12.1',
    '環境.ノート=1148 件 (回路 583 件)',
    '環境.計測=2026/10/29 14:00:00',
    'CPU.7z=シングル 3620 MIPS',
    'サーバ.parse:fixture=61.3ms 規模=10 件・50 図 固定 sha1=0.1ms 解析=55.0ms 抽出=6.1ms',
    'サーバ.search:抵抗=123ms 規模=20/48 件',
    'サーバ.thumb:fixture=失敗 (sharp missing)',
    '端末=未計測',
  ])
})

test('何も測っていなければ未計測と書く', () => {
  expect(formatBenchCopy({ cpu: null, server: null, clients: [] })).toContain('サーバ=未計測')
})

const SNAPSHOT = {
  rssMB: 210.4,
  heapUsedMB: 80.2,
  heapTotalMB: 120,
  externalMB: 20,
  arrayBuffersMB: 5,
  maxRssMB: 250,
  cgroupCurrentMB: 512.3,
  cgroupPeakMB: 900,
  uptimeSec: 3600,
}

test('項目の前後の差は RSS の前→後と増減を符号つきで書く', () => {
  expect(
    formatMemoryDelta({ rssBeforeMB: 200, rssAfterMB: 230, heapUsedDeltaMB: -10, externalDeltaMB: 6, maxRssGrowthMB: 30 }),
  ).toBe('rss=200→230MB heap=-10MB ext=+6MB 最大rss=+30MB')
})

test('周回の記録は cgroup と上限を併記し、無ければ省く', () => {
  expect(formatMemoryRound({ label: '開始', memory: SNAPSHOT }, 1600)).toBe(
    'メモリ.開始=rss 210MB heap 80/120MB ext 20MB 最大rss 250MB cgroup 512MB (ピーク 900MB / 上限 1600MB) 起動 3600秒',
  )
  expect(
    formatMemoryRound({ label: '周回 2', memory: { ...SNAPSHOT, cgroupCurrentMB: null, cgroupPeakMB: null } }, null),
  ).toBe('メモリ.周回 2=rss 210MB heap 80/120MB ext 20MB 最大rss 250MB 起動 3600秒')
})

test('コピーにメモリの行が入る (古い保存では出ない)', () => {
  const withMemory: ServerBenchResult = {
    ...SERVER,
    items: [
      { ...SERVER.items[1], memory: { rssBeforeMB: 200, rssAfterMB: 201, heapUsedDeltaMB: 0.5, externalDeltaMB: 0, maxRssGrowthMB: 0 } },
    ],
    failed: [],
    memoryRounds: [{ label: '開始', memory: SNAPSHOT }],
    cgroupMaxMB: null,
  }

  const lines = formatBenchCopy({ cpu: null, server: withMemory, clients: [] }).split('\n')

  expect(lines).toContain('サーバ.search:抵抗=123ms 規模=20/48 件 rss=200→201MB heap=+0.5MB ext=+0MB 最大rss=+0MB')
  expect(lines).toContain('メモリ.開始=rss 210MB heap 80/120MB ext 20MB 最大rss 250MB cgroup 512MB (ピーク 900MB) 起動 3600秒')
})
