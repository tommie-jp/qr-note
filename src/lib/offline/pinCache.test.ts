import { afterEach, expect, test, vi } from 'vitest'

import type { OfflineItem } from './item'
import { pinnedUrls, syncPinnedAssets } from './pinCache'

const IMAGE = '0421547b-ee29-4613-a6d4-da0f41f94054.jpg'
const VIDEO = '11111111-2222-3333-4444-555555555555.mkv'
const AUDIO = '22222222-3333-4444-5555-666666666666.mp3'
const PDF = '33333333-4444-5555-6666-777777777777.pdf'
const SECRET = '44444444-5555-6666-7777-888888888888'

function item(memo: string): OfflineItem {
  return {
    itemId: '4518',
    memo,
    title: '',
    tags: [],
    taskTodo: 0,
    taskDone: 0,
    updatedAt: '2026-08-01T00:00:00.000Z',
    accessedAt: '2026-08-01T00:00:00.000Z',
    pinned: true,
  }
}

// 印付きノートは「圏外で開くのに要る物」を 1 つも落とせない。
// 一覧サムネ (?thumb=1) と原寸は URL が違う = キャッシュとしては別物なので、
// 片方だけでは足りない
test('画像は原寸とサムネの両方を持ち出す', () => {
  // Arrange
  const note = item(`![図](/api/images/${IMAGE})`)

  // Act
  const urls = pinnedUrls(note)

  // Assert
  expect(urls).toContain(`/api/images/${IMAGE}`)
  expect(urls.some((url) => url.startsWith(`/api/images/${IMAGE}?thumb=1`))).toBe(true)
})

// 音声・PDF・テキストは thumb 列を持たない。取りに行くと 404 が返るだけで、
// 失敗の数が無意味に増える
test('サムネを持たない添付は原寸だけを持ち出す', () => {
  const urls = pinnedUrls(item(`![音](/api/images/${AUDIO})\n![資料](/api/images/${PDF})`))
  expect(urls).toEqual([`/api/images/${AUDIO}`, `/api/images/${PDF}`])
})

test('動画は poster を thumb 列に持つのでサムネも持ち出す', () => {
  const urls = pinnedUrls(item(`![録画](/api/images/${VIDEO})`))
  expect(urls).toHaveLength(2)
  expect(urls[0]).toBe(`/api/images/${VIDEO}`)
})

// 断片は暗号文のまま持ち出す (鍵は端末の中。docs/51 §7)
test('シークレット断片も持ち出す', () => {
  expect(pinnedUrls(item(`![住所](/api/secrets/${SECRET})`))).toEqual([
    `/api/secrets/${SECRET}`,
  ])
})

// 落とすのは「本文が参照している物」だけ。コードブロックの中に書かれた URL は
// 説明であって添付ではない (markdown/tags/tags.ts / images/memoImages.ts と同じ線引き)
test('コードの中の記法は持ち出さない', () => {
  expect(pinnedUrls(item(`\`\`\`\n![図](/api/images/${IMAGE})\n\`\`\``))).toEqual([])
})

test('外部の画像は持ち出さない', () => {
  expect(pinnedUrls(item('![外](https://example.com/a.jpg)'))).toEqual([])
})

test('同じ添付を 2 回貼っても 1 度だけ数える', () => {
  const urls = pinnedUrls(item(`![a](/api/images/${IMAGE})\n![b](/api/images/${IMAGE})`))
  expect(urls).toHaveLength(2)
})

test('添付の無いノートは何も持ち出さない', () => {
  expect(pinnedUrls(item('# 見出しだけ'))).toEqual([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// 撮影情報を抜く前の原寸は 1 年 immutable で HTTP キャッシュに残っていることがある。
// 持ち出しの棚を作り直すとき、それを拾うと棚ごと古い写しに戻ってしまう (docs/113 §8-5)
test('持ち出しの取得で、原寸は HTTP キャッシュを飛ばしサムネは使う', async () => {
  // Arrange
  const stored = new Map<string, Response>()
  const cache = {
    keys: async () => [],
    match: async (url: string) => stored.get(url),
    put: async (url: string, res: Response) => void stored.set(url, res),
    delete: async () => true,
  }
  const deleted: string[] = []
  vi.stubGlobal('caches', {
    open: async () => cache,
    delete: async (name: string) => void deleted.push(name),
  })
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('x', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  // Act
  await syncPinnedAssets([item(`![図](/api/images/${IMAGE})`)])

  // Assert
  const modes = new Map(
    fetchMock.mock.calls.map(([url, init]) => [url, init?.cache]),
  )
  expect(modes.get(`/api/images/${IMAGE}`)).toBe('reload')
  const thumb = [...modes.keys()].find((url) => url.includes('thumb='))
  expect(thumb).toBeDefined()
  expect(modes.get(thumb as string)).toBeUndefined()
})

test('持ち出しが全部揃ったら旧い棚 (v1) を捨てる', async () => {
  const deleted: string[] = []
  const cache = { keys: async () => [], match: async () => undefined, put: async () => {}, delete: async () => true }
  vi.stubGlobal('caches', { open: async () => cache, delete: async (n: string) => void deleted.push(n) })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 200 })))

  await syncPinnedAssets([item(`![図](/api/images/${IMAGE})`)])

  expect(deleted).toEqual(['qr-pin-v1'])
})

test('取りこぼしがあるうちは旧い棚 (v1) を残す', async () => {
  const deleted: string[] = []
  const cache = { keys: async () => [], match: async () => undefined, put: async () => {}, delete: async () => true }
  vi.stubGlobal('caches', { open: async () => cache, delete: async (n: string) => void deleted.push(n) })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })))

  await syncPinnedAssets([item(`![図](/api/images/${IMAGE})`)])

  expect(deleted).toEqual([])
})
