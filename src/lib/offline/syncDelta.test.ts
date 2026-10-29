import { describe, expect, test } from 'vitest'
import type { OfflineItem, OfflineSyncPayload } from './item'
import {
  canSyncByDelta,
  mergeSyncDelta,
  parseSyncDelta,
  parseSyncSince,
  SYNC_DELTA_MAX_AGE_MS,
  type OfflineSyncDelta,
} from './syncDelta'

// オフライン同期の差分 (docs/124 §4)。写しへの重ね方と、全件に倒す条件を固定する

const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const NOW = Date.parse('2026-10-30T12:00:00.000Z')

function note(itemId: string, updatedAt: string, memo = `# ${itemId}`): OfflineItem {
  return { itemId, memo, title: itemId, tags: [], taskTodo: 0, taskDone: 0, updatedAt, accessedAt: updatedAt, pinned: false }
}

const STORED: OfflineSyncPayload = {
  syncedAt: '2026-10-30T11:00:00.000Z',
  cursor: '2026-10-30T11:00:00.000Z',
  items: [note('b', '2026-10-29T00:00:00.000Z'), note('a', '2026-10-28T00:00:00.000Z')],
  truncated: false,
  circuits: [{ source: 'R', lang: 'circuitikz', svg: '<svg/>', hash: H1 }],
  circuitsOmitted: 0,
  etag: '"v-1"',
}

function delta(overrides: Partial<OfflineSyncDelta> = {}): OfflineSyncDelta {
  return {
    mode: 'delta',
    syncedAt: '2026-10-30T12:00:00.000Z',
    cursor: '2026-10-30T12:00:00.000Z',
    versions: [
      ['b', '2026-10-29T00:00:00.000Z', '2026-10-30T11:30:00.000Z', 1],
      ['a', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 0],
    ],
    items: [],
    circuits: [],
    circuitHashes: [H1],
    truncated: false,
    circuitsOmitted: 0,
    ...overrides,
  }
}

describe('canSyncByDelta', () => {
  test('起点があり、新しく、回路図がどれも hash を持てば乗れる', () => {
    expect(canSyncByDelta(STORED, NOW)).toBe(true)
  })

  test.each([
    ['写しが無い', null],
    ['起点が無い (古い版の写し)', { ...STORED, cursor: undefined }],
    ['古すぎる', { ...STORED, cursor: new Date(NOW - SYNC_DELTA_MAX_AGE_MS - 1).toISOString() }],
    ['hash の無い回路図がある', { ...STORED, circuits: [{ source: 'R', lang: 'circuitikz' as const, svg: '<svg/>' }] }],
  ])('%s なら全件', (_label, stored) => {
    expect(canSyncByDelta(stored, NOW)).toBe(false)
  })
})

describe('parseSyncSince', () => {
  test('読める起点は Date にする', () => {
    expect(parseSyncSince('2026-10-30T11:00:00.000Z', NOW)?.toISOString()).toBe('2026-10-30T11:00:00.000Z')
  })

  test.each([
    ['無い', null],
    ['読めない', 'きのう'],
    ['長すぎる', '2026-10-30T11:00:00.000Z'.padEnd(80, 'x')],
    ['未来', '2026-10-30T12:05:00.000Z'],
    ['古すぎる', new Date(NOW - SYNC_DELTA_MAX_AGE_MS - 1000).toISOString()],
  ])('%s起点は null (全件に倒す)', (_label, raw) => {
    expect(parseSyncSince(raw, NOW)).toBeNull()
  })
})

describe('parseSyncDelta', () => {
  test('差分の形を読む。hash の無い回路図は落とす', () => {
    // Act
    const parsed = parseSyncDelta({
      ...delta(),
      circuits: [
        { source: 'C', lang: 'circuitikz', svg: '<svg/>', hash: H2 },
        { source: 'D', lang: 'circuitikz', svg: '<svg/>' },
      ],
    })

    // Assert
    expect(parsed?.versions).toHaveLength(2)
    expect(parsed?.circuits.map((c) => c.hash)).toEqual([H2])
  })

  test.each([
    ['全件の形', { syncedAt: 'x', items: [] }],
    ['版の 1 件が壊れている', { ...delta(), versions: [['a', 'x', 'y', 2]] }],
    ['本文の 1 件が壊れている', { ...delta(), items: [{ itemId: 'a' }] }],
  ])('%s は読まない', (_label, data) => {
    expect(parseSyncDelta(data)).toBeNull()
  })
})

describe('mergeSyncDelta', () => {
  test('本文の来ないノートは写しのまま、見た時刻と印は版の一覧で差し替える', () => {
    // Act
    const merged = mergeSyncDelta(STORED, delta())

    // Assert
    expect(merged?.items.map((i) => [i.itemId, i.memo, i.accessedAt, i.pinned])).toEqual([
      ['b', '# b', '2026-10-30T11:30:00.000Z', true],
      ['a', '# a', '2026-10-28T00:00:00.000Z', false],
    ])
    expect(merged?.cursor).toBe('2026-10-30T12:00:00.000Z')
    expect(merged?.circuits.map((c) => c.hash)).toEqual([H1])
  })

  test('書き換わったノートは届いた本文に、並びは版の一覧に従う', () => {
    // Act
    const merged = mergeSyncDelta(
      STORED,
      delta({
        versions: [
          ['a', '2026-10-30T11:50:00.000Z', '2026-10-30T11:50:00.000Z', 0],
          ['b', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 0],
        ],
        items: [note('a', '2026-10-30T11:50:00.000Z', '# a を直した')],
      }),
    )

    // Assert
    expect(merged?.items.map((i) => [i.itemId, i.memo])).toEqual([
      ['a', '# a を直した'],
      ['b', '# b'],
    ])
  })

  test('版の一覧に無いノートは写しから消える (ゴミ箱へ入れた)', () => {
    // Act
    const merged = mergeSyncDelta(STORED, delta({ versions: [delta().versions[0]] }))

    // Assert
    expect(merged?.items.map((i) => i.itemId)).toEqual(['b'])
  })

  test.each([
    ['写しに無いノートが版の一覧にある (ゴミ箱から戻した)', [['z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0]]],
    ['本文が来ないのに版が違う', [['a', '2026-10-30T11:59:00.000Z', '2026-10-30T11:59:00.000Z', 0]]],
  ] as const)('%s なら null (全件を取り直す)', (_label, versions) => {
    expect(mergeSyncDelta(STORED, delta({ versions: [...versions] }))).toBeNull()
  })

  test('回路図は持つべき一覧に絞り、届いた図を足し、無い図は運べなかったに数える', () => {
    // Act
    const merged = mergeSyncDelta(
      STORED,
      delta({
        circuits: [{ source: 'C', lang: 'circuitikz', svg: '<svg id="c"/>', hash: H2 }],
        circuitHashes: [H2, 'c'.repeat(64)],
      }),
    )

    // Assert: H1 は一覧に無いので捨て、H2 は足し、c… は端末に無い
    expect(merged?.circuits.map((c) => c.hash)).toEqual([H2])
    expect(merged?.circuitsOmitted).toBe(1)
  })
})
