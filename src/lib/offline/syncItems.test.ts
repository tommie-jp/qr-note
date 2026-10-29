import { beforeEach, describe, expect, test, vi } from 'vitest'
import { circuitHash } from '@/lib/circuit/hash'

// 同期の口の中身 (docs/65 §3-1・docs/124 §4)。DB だけを差し替え、全件と差分の
// 取り合わせ (どのノートの本文・どの図を運ぶか) を固定する
const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  svgs: [] as unknown[],
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    item: { findMany: async () => mocks.items },
    circuitSvg: { findMany: async () => mocks.svgs },
    // 回路フェンスの控えは空のまま。毎回解析に落ちる
    memoCircuitFences: { findMany: async () => [], createMany: async () => ({ count: 0 }) },
  },
}))

const { loadOfflineSyncDelta, loadOfflineSyncPayload } = await import('./syncItems')

const fence = (source: string) => `\`\`\`circuitikz\n${source}\n\`\`\``
const row = (itemId: string, updatedAt: string, memo: string) => ({
  itemId,
  memo,
  title: itemId,
  tags: [],
  taskTodo: 0,
  taskDone: 0,
  updatedAt: new Date(updatedAt),
  accessedAt: new Date(updatedAt),
  offlinePin: false,
})

const SINCE = new Date('2026-10-30T12:00:00.000Z')

beforeEach(() => {
  mocks.items = [
    row('new', '2026-10-30T12:30:00.000Z', `直した\n${fence('A')}`),
    row('old', '2026-10-01T00:00:00.000Z', `古い\n${fence('B')}\n${fence('C')}`),
  ]
  mocks.svgs = [
    { hash: circuitHash('A'), svg: '<svg id="a"/>', createdAt: new Date('2026-09-01T00:00:00.000Z') },
    { hash: circuitHash('B'), svg: '<svg id="b"/>', createdAt: new Date('2026-09-01T00:00:00.000Z') },
    // C は起点の後に描けた (古いノートの図)
    { hash: circuitHash('C'), svg: '<svg id="c"/>', createdAt: new Date('2026-10-30T12:10:00.000Z') },
  ]
})

describe('loadOfflineSyncPayload (全件)', () => {
  test('全ノートと図を運び、図には hash を、写しには起点 (cursor) を付ける', async () => {
    // Act
    const payload = await loadOfflineSyncPayload()

    // Assert
    expect(payload.items.map((i) => i.itemId)).toEqual(['new', 'old'])
    expect(payload.circuits.map((c) => c.hash)).toEqual([circuitHash('A'), circuitHash('B'), circuitHash('C')])
    expect(payload.circuits[0]).not.toHaveProperty('createdAt')
    expect(Date.parse(payload.cursor ?? '')).toBeLessThanOrEqual(Date.parse(payload.syncedAt))
  })
})

describe('loadOfflineSyncDelta (差分)', () => {
  test('本文は起点の後に書き換わったノートだけ、版の一覧は全ノート', async () => {
    // Act
    const delta = await loadOfflineSyncDelta(SINCE)

    // Assert
    expect(delta.mode).toBe('delta')
    expect(delta.items.map((i) => i.itemId)).toEqual(['new'])
    expect(delta.versions).toEqual([
      ['new', '2026-10-30T12:30:00.000Z', '2026-10-30T12:30:00.000Z', 0],
      ['old', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 0],
    ])
  })

  test('図は書き換わったノートの図と起点の後に描けた図だけを運び、持つべき図は全部を挙げる', async () => {
    // Act
    const delta = await loadOfflineSyncDelta(SINCE)

    // Assert: A は new の図、C は描けたばかり。B は古いノートの古い図なので運ばない
    expect(delta.circuits.map((c) => c.hash)).toEqual([circuitHash('A'), circuitHash('C')])
    expect(delta.circuitHashes).toEqual([circuitHash('A'), circuitHash('B'), circuitHash('C')])
  })

  test('起点の少し前 (10 秒以内) に書き換わったノートも運ぶ (時計のずれを吸う)', async () => {
    // Arrange
    mocks.items = [row('edge', '2026-10-30T11:59:55.000Z', 'ぎりぎり')]

    // Act
    const delta = await loadOfflineSyncDelta(SINCE)

    // Assert
    expect(delta.items.map((i) => i.itemId)).toEqual(['edge'])
  })
})
