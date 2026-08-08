import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  cachedQueries,
  fetchQueries,
  recordQueryUse,
  registerSavedQuery,
  resetQueryCache,
  unregisterSavedQuery,
} from './searchQueryClient'

// 応答の中身だけを差し替えて、口の叩き方と検算を見る。実際の route は
// app/api/search-queries/route.test.ts が受け持つ。
function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

function lastCall(): [string, RequestInit] {
  const mock = vi.mocked(globalThis.fetch)
  return mock.mock.calls[mock.mock.calls.length - 1] as unknown as [string, RequestInit]
}

const OK = { success: true, data: { saved: ['is:todo'], recent: ['抵抗'] }, error: null }

beforeEach(() => {
  resetQueryCache()
  // 失敗の記録だけは残す方針なので、テスト中の warn は黙らせる
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchQueries', () => {
  test('reads both lists back and caches them', async () => {
    // Arrange
    respondWith(OK)

    // Act
    const lists = await fetchQueries()

    // Assert
    expect(lists).toEqual({ saved: ['is:todo'], recent: ['抵抗'] })
    expect(cachedQueries()).toEqual(lists)
  })

  test('asks for no caching (another device may have added entries)', async () => {
    respondWith(OK)

    await fetchQueries()

    expect(lastCall()[1].cache).toBe('no-store')
  })

  test('returns null on an error status instead of throwing', async () => {
    respondWith({ success: false, data: null, error: 'ログインが必要です' }, 401)

    expect(await fetchQueries()).toBeNull()
    expect(cachedQueries()).toBeNull()
  })

  test('returns null when the server sends something unexpected', async () => {
    // 型が合わない物を画面へ流すと描画側で落ちる
    respondWith({ success: true, data: { saved: 'is:todo' }, error: null })

    expect(await fetchQueries()).toBeNull()
  })

  test('drops entries that are not usable strings', async () => {
    respondWith({ success: true, data: { saved: ['a', '', 7, null], recent: [] }, error: null })

    expect(await fetchQueries()).toEqual({ saved: ['a'], recent: [] })
  })

  test('survives the network being gone (search itself still works)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )

    expect(await fetchQueries()).toBeNull()
  })
})

describe('recordQueryUse', () => {
  test('posts the query without waiting for the answer', async () => {
    // Arrange
    respondWith(OK)

    // Act
    recordQueryUse('コンデンサ')

    // Assert
    const [url, init] = lastCall()
    expect(url).toBe('/api/search-queries')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'コンデンサ' })
  })

  test('keeps the request alive across the navigation it triggers', async () => {
    // 結果のノートを開いた瞬間にも呼ばれる。付けないと遷移で捨てられる
    respondWith(OK)

    recordQueryUse('コンデンサ')

    expect(lastCall()[1].keepalive).toBe(true)
  })

  test('moves the cached lists forward straight away', async () => {
    respondWith(OK)
    await fetchQueries() // saved: is:todo / recent: 抵抗

    recordQueryUse('コンデンサ')

    expect(cachedQueries()?.recent).toEqual(['コンデンサ', '抵抗'])
  })

  test('touches a registered pattern instead of adding it to the history', async () => {
    respondWith(OK)
    await fetchQueries()

    recordQueryUse('is:todo')

    expect(cachedQueries()).toEqual({ saved: ['is:todo'], recent: ['抵抗'] })
  })

  test('ignores an empty query without calling the server', async () => {
    respondWith(OK)

    recordQueryUse('   ')

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('registerSavedQuery / unregisterSavedQuery', () => {
  test('registers through the saved endpoint', async () => {
    respondWith(OK)

    await registerSavedQuery('is:todo')

    const [url, init] = lastCall()
    expect(url).toBe('/api/search-queries/saved')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'is:todo' })
  })

  test('unregisters through the same endpoint', async () => {
    respondWith(OK)

    await unregisterSavedQuery('is:todo')

    const [url, init] = lastCall()
    expect(url).toBe('/api/search-queries/saved')
    expect(init.method).toBe('DELETE')
  })

  test('returns null when the list is already full (409)', async () => {
    respondWith({ success: false, data: null, error: '登録パターンは 10 件までです' }, 409)

    expect(await registerSavedQuery('one-too-many')).toBeNull()
  })
})
