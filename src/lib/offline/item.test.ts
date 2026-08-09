import { describe, expect, test } from 'vitest'

import { parseSyncPayload, type OfflineItem } from './item'

// 正しい 1 件。個々のテストは必要な列だけ上書きして使う
function validItem(over: Partial<Record<keyof OfflineItem, unknown>> = {}) {
  return {
    itemNo: '4518',
    itemNoNum: 4518,
    memo: '# 2SC1815\n#bjt #npn',
    url: '',
    mode: 'memo',
    title: '2SC1815',
    tags: ['bjt', 'npn'],
    taskTodo: 0,
    taskDone: 0,
    updatedAt: '2026-08-01T00:00:00.000Z',
    accessedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  }
}

function payload(items: unknown[]) {
  return { syncedAt: '2026-08-08T12:00:00.000Z', items }
}

describe('parseSyncPayload', () => {
  test('正しい応答をそのまま読み取る', () => {
    // Arrange
    const data = payload([validItem()])

    // Act
    const parsed = parseSyncPayload(data)

    // Assert
    expect(parsed).not.toBeNull()
    expect(parsed?.syncedAt).toBe('2026-08-08T12:00:00.000Z')
    expect(parsed?.items).toHaveLength(1)
    expect(parsed?.items[0].itemNo).toBe('4518')
    expect(parsed?.items[0].tags).toEqual(['bjt', 'npn'])
  })

  test('封筒が壊れていれば null を返す', () => {
    expect(parseSyncPayload(null)).toBeNull()
    expect(parseSyncPayload('items')).toBeNull()
    expect(parseSyncPayload({ syncedAt: '2026-08-08T12:00:00.000Z' })).toBeNull()
    expect(parseSyncPayload({ items: [] })).toBeNull()
    expect(parseSyncPayload({ syncedAt: 1, items: [] })).toBeNull()
  })

  test('items が空でも成功する (全ノートを消した直後)', () => {
    expect(parseSyncPayload(payload([]))?.items).toEqual([])
  })

  // 1 件の形式違いで全部を捨てない。**同期そのものが失敗するほうが害が大きい** —
  // 圏外で開いたときに 1 件のせいでノートが 1 つも出なくなる
  test('形の違う 1 件だけを落として残りは残す', () => {
    // Arrange
    const data = payload([
      validItem({ itemNo: '' }),
      validItem({ itemNo: '4519', tags: ['ok'] }),
      validItem({ tags: 'bjt' }),
      validItem({ memo: 42 }),
      validItem({ taskTodo: 'many' }),
      validItem({ updatedAt: null }),
      'not an object',
    ])

    // Act
    const parsed = parseSyncPayload(data)

    // Assert
    expect(parsed?.items.map((i) => i.itemNo)).toEqual(['4519'])
  })

  // タグ配列に文字列でない物が混ざっても、その 1 つを落とすだけ。
  // タグは検索の絞り込みにしか使わず、1 つ欠けてもノート自体は読める
  test('タグ配列の中の非文字列だけを落とす', () => {
    const parsed = parseSyncPayload(payload([validItem({ tags: ['bjt', 7, null, 'npn'] })]))
    expect(parsed?.items[0].tags).toEqual(['bjt', 'npn'])
  })

  test('mode は url 以外をすべて memo に倒す (validation.ts と同じ流儀)', () => {
    expect(parseSyncPayload(payload([validItem({ mode: 'url' })]))?.items[0].mode).toBe('url')
    expect(parseSyncPayload(payload([validItem({ mode: 'memo' })]))?.items[0].mode).toBe('memo')
    expect(parseSyncPayload(payload([validItem({ mode: 'xxx' })]))?.items[0].mode).toBe('memo')
  })

  test('itemNoNum は数値か null のみ受ける', () => {
    expect(parseSyncPayload(payload([validItem({ itemNoNum: null })]))?.items[0].itemNoNum).toBeNull()
    expect(parseSyncPayload(payload([validItem({ itemNoNum: '100x' })]))?.items).toEqual([])
  })

  test('truncated は true のときだけ立つ (読めない値は切っていない扱い)', () => {
    expect(parseSyncPayload(payload([]))?.truncated).toBe(false)
    expect(parseSyncPayload({ ...payload([]), truncated: true })?.truncated).toBe(true)
    expect(parseSyncPayload({ ...payload([]), truncated: 'yes' })?.truncated).toBe(false)
  })

  // 印は「通信量を使ってよい」という同意そのもの。読めない値を true に倒すと、
  // 同意していないノートの原寸添付まで自動で落とし始める
  test('pinned は true のときだけ立つ (読めない値は印なしへ倒す)', () => {
    expect(parseSyncPayload(payload([validItem()]))?.items[0].pinned).toBe(false)
    expect(parseSyncPayload(payload([validItem({ pinned: true })]))?.items[0].pinned).toBe(true)
    expect(parseSyncPayload(payload([validItem({ pinned: 'yes' })]))?.items[0].pinned).toBe(false)
  })
})

// 回路図 (docs/65-オフライン対応計画.md §8)。
//
// **無くても本文は読める** (コードブロックとして出る) ので、読めない形は
// 落とすだけで同期そのものは成功させる。
describe('parseSyncPayload の回路図', () => {
  const circuit = { source: '\\draw (0,0) to[R] (2,0);', svg: '<svg></svg>' }

  test('回路図をそのまま読み取る', () => {
    const parsed = parseSyncPayload({ ...payload([]), circuits: [circuit] })
    expect(parsed?.circuits).toEqual([circuit])
  })

  test('回路図が無い応答は空配列になる (古い版のサーバ・保存)', () => {
    expect(parseSyncPayload(payload([]))?.circuits).toEqual([])
    expect(parseSyncPayload({ ...payload([]), circuits: 'x' })?.circuits).toEqual([])
  })

  test('形の違う 1 枚だけを落とす', () => {
    // Arrange
    const data = {
      ...payload([]),
      circuits: [{ source: '', svg: '<svg/>' }, { source: 'a' }, circuit, 42],
    }

    // Act
    const parsed = parseSyncPayload(data)

    // Assert
    expect(parsed?.circuits).toEqual([circuit])
  })

  test('circuitsOmitted は有限の数値のときだけ読む', () => {
    expect(parseSyncPayload(payload([]))?.circuitsOmitted).toBe(0)
    expect(parseSyncPayload({ ...payload([]), circuitsOmitted: 3 })?.circuitsOmitted).toBe(3)
    expect(parseSyncPayload({ ...payload([]), circuitsOmitted: '3' })?.circuitsOmitted).toBe(0)
    expect(parseSyncPayload({ ...payload([]), circuitsOmitted: NaN })?.circuitsOmitted).toBe(0)
  })
})
