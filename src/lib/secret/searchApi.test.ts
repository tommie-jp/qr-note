import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchSecretTextBlobs, fetchSecretTextIndex } from './searchApi'

// シークレット内検索の材料を取る口 (docs/130-シークレット内検索計画.md §5-1)。
// 応答だけを差し替えて、口の叩き方と検算を見る
function respondWith(data: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success: true, data, error: null }))),
  )
}

function lastCall(): [string, RequestInit] {
  const mock = vi.mocked(globalThis.fetch)
  return mock.mock.calls[mock.mock.calls.length - 1] as unknown as [string, RequestInit]
}

const A = '0421547b-ee29-4613-a6d4-da0f41f94054'
const B = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const ENTRY = { name: A, hash: 'abc', bytes: 40, refs: [{ itemId: 'n1', title: '銀行', label: '口座' }] }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchSecretTextIndex', () => {
  test('一覧を GET で取る (検索語は送らない)', async () => {
    respondWith({ entries: [ENTRY] })

    const entries = await fetchSecretTextIndex()

    expect(entries).toEqual([ENTRY])
    const [url, init] = lastCall()
    expect(url).toBe('/api/secret-texts')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  test.each([
    ['entries が無い', {}],
    ['名前が UUID でない', { entries: [{ ...ENTRY, name: '../x' }] }],
    ['大きさが数でない', { entries: [{ ...ENTRY, bytes: '40' }] }],
    ['大きさが負', { entries: [{ ...ENTRY, bytes: -1 }] }],
    ['参照元が配列でない', { entries: [{ ...ENTRY, refs: null }] }],
    ['参照元の形が違う', { entries: [{ ...ENTRY, refs: [{ itemId: 1, title: '', label: '' }] }] }],
    ['行がオブジェクトでない', { entries: [null] }],
  ])('形が違う応答 (%s) は読まずに投げる', async (_label, data) => {
    respondWith(data)

    await expect(fetchSecretTextIndex()).rejects.toThrow('シークレットの一覧を読み取れませんでした')
  })
})

describe('fetchSecretTextBlobs', () => {
  test('名前だけを POST して、暗号文をバイト列に戻す', async () => {
    respondWith({ blobs: [{ name: A, data: 'AQID' }] })

    const blobs = await fetchSecretTextBlobs([A, B])

    expect([...blobs]).toEqual([[A, new Uint8Array([1, 2, 3])]])
    const [url, init] = lastCall()
    expect(url).toBe('/api/secret-texts')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ names: [A, B] })
  })

  test('頼んでいない名前・読めない行は捨てる', async () => {
    respondWith({
      blobs: [{ name: B, data: 'AQID' }, { name: A, data: 5 }, null, { name: A, data: '***' }],
    })

    const blobs = await fetchSecretTextBlobs([A])

    expect([...blobs]).toEqual([])
  })

  test('blobs が無い応答は投げる', async () => {
    respondWith({})

    await expect(fetchSecretTextBlobs([A])).rejects.toThrow('シークレットの一覧を読み取れませんでした')
  })
})
