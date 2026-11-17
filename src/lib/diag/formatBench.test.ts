import { expect, test } from 'vitest'
import { envRows, formatBenchCopy, formatMemUsage, formatMemoryDelta, formatMemoryRound, formatMiB, formatMs, formatPhases, hostLines } from './formatBench'
import type { HostSnapshot, ServerBenchResult } from './benchTypes'

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

const HOST: HostSnapshot = {
  takenAt: '2026-11-17T05:00:00.000Z',
  freeMem: {
    totalMB: 1962, usedMB: 757, freeMB: 120, sharedMB: 12, buffCacheMB: 1076, availableMB: 1205,
    swapTotalMB: 2047, swapUsedMB: 713, swapFreeMB: 1334,
  },
  containers: [
    { id: 'b786a64d6bb2', name: 'qr-search-app-1', isSelf: true, cpuPercent: 0.5, memUsageMB: 215, memLimitMB: 1600, pids: 11 },
    { id: 'aaaaaaaaaaaa', name: null, isSelf: false, cpuPercent: null, memUsageMB: 12, memLimitMB: 1962, pids: null },
  ],
  namesAt: null,
  notes: ['コンテナ名: 表が無い'],
}

test('メモリは docker stats と同じく 1GiB 未満を MiB、以上を GiB で書く', () => {
  expect(formatMiB(215)).toBe('215.0MiB')
  expect(formatMiB(1600)).toBe('1.56GiB')
  expect(formatMemUsage(HOST.containers[0]!)).toBe('215.0MiB / 1.56GiB (13.44%)')
})

test('ホストの行は free -m の列とコンテナごとの docker stats の値を 1 行ずつ出す', () => {
  expect(hostLines(HOST)).toEqual([
    'ホスト.取得=2026/11/17 14:00:00 (計測前)',
    'ホスト.Mem=total 1962 used 757 free 120 shared 12 buff/cache 1076 available 1205 (MiB)',
    'ホスト.Swap=total 2047 used 713 free 1334 (MiB)',
    'コンテナ.qr-search-app-1 (このアプリ)=CPU 0.50% MEM 215.0MiB / 1.56GiB (13.44%) PIDS 11',
    'コンテナ.aaaaaaaaaaaa=CPU 不明 MEM 12.0MiB / 1.92GiB (0.61%) PIDS 不明',
    'ホスト.注意=コンテナ名: 表が無い',
  ])
})

test('ホストの節はサーバの行の後ろに入り、古い保存 (host 無し) では出ない', () => {
  expect(formatBenchCopy({ cpu: null, server: { ...SERVER, host: HOST }, clients: [] })).toContain('ホスト.Mem=total 1962')
  expect(formatBenchCopy({ cpu: null, server: SERVER, clients: [] })).not.toContain('ホスト.')
})

test('環境の先頭にホスト名と OS を出し、古い保存 (kernel 無し) では出さない', () => {
  // Arrange
  const env = { ...SERVER.env, hostName: 'vps1', osName: 'Ubuntu 26.04.1 LTS', kernel: '7.0.0-15-generic' }

  // Act
  const rows = envRows(env)

  // Assert
  expect(rows.slice(0, 2)).toEqual([
    { label: 'ホスト名', value: 'vps1' },
    { label: 'OS', value: 'Ubuntu 26.04.1 LTS (カーネル 7.0.0-15-generic)' },
  ])
  expect(envRows(SERVER.env)[0]?.label).toBe('CPU')
  expect(envRows({ ...env, hostName: null, osName: null })[0]?.value).toBe('不明')
})

test('画面用に now を渡すと計測の日時に相対時刻が付き、コピー用 (now 無し) には付かない', () => {
  const now = new Date('2026-11-08T05:00:00.000Z')
  const value = (rows: { label: string; value: string }[]) => rows.find((row) => row.label === '計測')?.value
  expect(value(envRows(SERVER.env, now))).toBe('2026/10/29 14:00:00(10日前)')
  expect(value(envRows(SERVER.env))).toBe('2026/10/29 14:00:00')
})
