import { expect, test } from 'vitest'
import { formatBenchCopy, formatMs, formatPhases } from './formatBench'
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
