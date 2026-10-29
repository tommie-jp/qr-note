import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ノート本文の取り込み (docs/65-オフライン対応計画.md §3-2)。
// IndexedDB への保存 (snapshotDb) と fetch を差し替え、画面に出る失敗の文言と
// 「サーバを無条件に信じない」読み方を固定する
const mocks = vi.hoisted(() => ({
  saved: [] as unknown[],
  stored: null as unknown,
}))

vi.mock('./snapshotDb', () => ({
  saveOfflineSnapshot: async (payload: unknown) => {
    mocks.saved.push(payload)
  },
  loadOfflineSnapshot: async () => mocks.stored,
}))

const { syncOfflineItems } = await import('./sync')

const PAYLOAD = {
  syncedAt: '2026-09-13T00:00:00.000Z',
  items: [],
  truncated: false,
  circuits: [],
}

function respond(status: number, body: string): void {
  // 304 は本文を持てない (Response が '' でも断る)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(status === 304 ? null : body, { status })),
  )
}

beforeEach(() => {
  mocks.saved = []
  mocks.stored = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('syncOfflineItems', () => {
  test('封筒の data を読んで保存し、そのまま返す', async () => {
    // Arrange
    respond(200, JSON.stringify({ success: true, data: PAYLOAD, error: null }))

    // Act
    const { payload, changed } = await syncOfflineItems()

    // Assert
    expect(payload).toMatchObject({ syncedAt: PAYLOAD.syncedAt, items: [] })
    expect(changed).toBe(true)
    expect(mocks.saved).toEqual([payload])
  })

  test('キャッシュさせずに叩く。写しが無ければ If-None-Match は付けない', async () => {
    respond(200, JSON.stringify({ success: true, data: PAYLOAD, error: null }))

    await syncOfflineItems()

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/sync/items', {
      cache: 'no-store',
      headers: {},
    })
  })

  // 変化が無ければ本文を受け直さない (docs/118 §4-2)
  describe('写しに版 (etag) があるとき', () => {
    const STORED = { ...PAYLOAD, circuitsOmitted: 0, etag: '"v-1"' }

    test('版を If-None-Match で送る', async () => {
      mocks.stored = STORED
      respond(200, JSON.stringify({ success: true, data: { ...PAYLOAD, etag: '"v-2"' }, error: null }))

      await syncOfflineItems()

      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/sync/items', {
        cache: 'no-store',
        headers: { 'If-None-Match': '"v-1"' },
      })
    })

    test('304 なら写しを触らずにそのまま返し、changed は false', async () => {
      mocks.stored = STORED
      respond(304, '')

      const result = await syncOfflineItems()

      expect(result).toEqual({ payload: STORED, changed: false })
      expect(mocks.saved).toEqual([])
    })

    test('新しい版が返れば保存し、写しの etag も新しくなる', async () => {
      mocks.stored = STORED
      respond(200, JSON.stringify({ success: true, data: { ...PAYLOAD, etag: '"v-2"' }, error: null }))

      const { payload, changed } = await syncOfflineItems()

      expect(changed).toBe(true)
      expect(payload.etag).toBe('"v-2"')
      expect(mocks.saved).toEqual([payload])
    })
  })

  // 写しが無いのに 304 が来ることは無いはずだが、来ても「読めない」に倒す
  test('写しが無いのに 304 なら失敗として投げる', async () => {
    respond(304, '')

    await expect(syncOfflineItems()).rejects.toThrow('同期に失敗しました (HTTP 304)')
  })

  // この口は必ず 401 を返すので「ログインし直し」と言い切れる
  test('401 はログインし直しを促す', async () => {
    respond(401, JSON.stringify({ success: false, data: null, error: 'ログインが必要です' }))

    await expect(syncOfflineItems()).rejects.toThrow(
      'ログインの期限が切れています。ログインし直してください',
    )
    expect(mocks.saved).toEqual([])
  })

  test('それ以外の失敗は HTTP の状態を添える', async () => {
    respond(503, '<html>maintenance</html>')

    await expect(syncOfflineItems()).rejects.toThrow('同期に失敗しました (HTTP 503)')
  })

  test('data の形が違えば保存せずに投げる', async () => {
    respond(200, JSON.stringify({ success: true, data: { items: 'x' }, error: null }))

    await expect(syncOfflineItems()).rejects.toThrow('同期の応答を読み取れませんでした')
    expect(mocks.saved).toEqual([])
  })

  test('封筒でない本文も読み取れない扱い', async () => {
    respond(200, 'null')

    await expect(syncOfflineItems()).rejects.toThrow('同期の応答を読み取れませんでした')
  })
})

// 差分の同期 (docs/124 §4)
describe('差分', () => {
  const H1 = 'a'.repeat(64)
  const item = (itemId: string, updatedAt: string, memo = `# ${itemId}`) => ({
    itemId, memo, title: itemId, tags: [], taskTodo: 0, taskDone: 0, updatedAt, accessedAt: updatedAt, pinned: false,
  })
  const cursor = new Date(Date.now() - 60_000).toISOString()
  const STORED = {
    syncedAt: cursor,
    cursor,
    items: [item('a', '2026-10-28T00:00:00.000Z')],
    truncated: false,
    circuits: [{ source: 'R', lang: 'circuitikz', svg: '<svg/>', hash: H1 }],
    circuitsOmitted: 0,
    etag: '"v-1"',
  }
  const DELTA = {
    mode: 'delta',
    syncedAt: '2026-10-30T12:00:00.000Z',
    cursor: '2026-10-30T12:00:00.000Z',
    versions: [['a', '2026-10-28T00:00:00.000Z', '2026-10-30T11:00:00.000Z', 0]],
    items: [],
    circuits: [],
    circuitHashes: [H1],
    truncated: false,
    circuitsOmitted: 0,
    etag: '"v-2"',
  }

  test('写しの起点を since で送り、届いた差分を写しに重ねて保存する', async () => {
    // Arrange
    mocks.stored = STORED
    respond(200, JSON.stringify({ success: true, data: DELTA, error: null }))

    // Act
    const { payload } = await syncOfflineItems()

    // Assert
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(`/api/sync/items?since=${encodeURIComponent(cursor)}`)
    expect(payload.items).toEqual([{ ...STORED.items[0], accessedAt: '2026-10-30T11:00:00.000Z' }])
    expect(payload.circuits).toEqual(STORED.circuits)
    expect(payload).toMatchObject({ cursor: DELTA.cursor, etag: '"v-2"' })
    expect(mocks.saved).toEqual([payload])
  })

  test('写しに重ねられない差分なら、起点も版も付けずに全件を取り直す', async () => {
    // Arrange: 写しに無いノート z が版の一覧にある (ゴミ箱から戻した)
    mocks.stored = STORED
    const broken = { ...DELTA, versions: [['z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0]] }
    const full = { ...PAYLOAD, items: [item('z', '2026-01-01T00:00:00.000Z')], cursor: 'c2' }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: broken, error: null })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: full, error: null }))),
    )

    // Act
    const { payload } = await syncOfflineItems()

    // Assert
    const calls = vi.mocked(globalThis.fetch).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(['/api/sync/items', { cache: 'no-store', headers: {} }])
    expect(payload.items.map((i) => i.itemId)).toEqual(['z'])
  })

  test('起点の無い写し (古い版) は全件を取る', async () => {
    // Arrange
    mocks.stored = { ...STORED, cursor: undefined }
    respond(200, JSON.stringify({ success: true, data: PAYLOAD, error: null }))

    // Act
    await syncOfflineItems()

    // Assert
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('/api/sync/items')
  })
})
