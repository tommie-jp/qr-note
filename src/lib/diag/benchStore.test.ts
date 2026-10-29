import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { ClientBenchRun, ServerBenchResult } from './benchTypes'

vi.mock('server-only', () => ({}))

const { readClientBenches, readServerBench, saveClientBench, saveServerBench } = await import('./benchStore')

const dir = () => mkdtemp(join(tmpdir(), 'bench-store-'))

const SERVER: ServerBenchResult = {
  version: 1,
  env: {
    cpuModel: 'Test CPU',
    threads: 4,
    totalMemMB: 4096,
    nodeVersion: 'v26.0.0',
    appVersion: '0.0.0',
    items: 10,
    circuitItems: 2,
    measuredAt: '2026-10-29T00:00:00.000Z',
  },
  items: [{ id: 'parse:fixture', label: '見本', medianMs: 12.3, scale: '10 件', phases: { 解析: 11 }, fixed: true }],
  failed: [],
}

const run = (device: string, line: string, value: string): ClientBenchRun => ({
  version: 1,
  device,
  line,
  panes: '2',
  width: '390x844',
  measuredAt: '2026-10-29T00:00:00.000Z',
  rows: [{ label: '全体', value }],
})

describe('サーバ側の結果', () => {
  test('無ければ null (未計測)', async () => {
    expect(await readServerBench(join(await dir(), 'none.json'))).toBeNull()
  })

  test('保存した物を読み戻せる', async () => {
    const path = join(await dir(), 's.json')

    await saveServerBench(SERVER, path)

    expect(await readServerBench(path)).toEqual(SERVER)
  })

  test('形が違えば投げる (未計測と取り違えない)', async () => {
    const path = join(await dir(), 'bad.json')
    await writeFile(path, '{"version":1}')

    await expect(readServerBench(path)).rejects.toThrow('形が不正')
  })
})

describe('端末の結果', () => {
  test('端末 × 回線ごとに最新 1 回を持ち、同じ鍵は上書きする', async () => {
    const path = join(await dir(), 'c.json')

    await saveClientBench(run('PC', '有線', '1s'), path)
    await saveClientBench(run('iPhone', 'キャリア', '3s'), path)
    await saveClientBench(run('PC', '有線', '2s'), path)

    const saved = await readClientBenches(path)
    expect(Object.keys(saved).sort()).toEqual(['PC/有線', 'iPhone/キャリア'])
    expect(saved['PC/有線'].rows).toEqual([{ label: '全体', value: '2s' }])
  })

  test('壊れたファイルには上書きせず投げる (他の端末の結果を消さない)', async () => {
    const path = join(await dir(), 'broken.json')
    await writeFile(path, '{"PC/有線": {"version": 2}}')

    await expect(saveClientBench(run('PC', '有線', '1s'), path)).rejects.toThrow('形が不正')
  })
})

test('同時に 2 台が保存しても両方残る', async () => {
  const path = join(await dir(), 'race.json')

  await Promise.all([saveClientBench(run('PC', '有線', '1s'), path), saveClientBench(run('iPhone', 'Wi-Fi', '2s'), path)])

  expect(Object.keys(await readClientBenches(path)).sort()).toEqual(['PC/有線', 'iPhone/Wi-Fi'])
})
