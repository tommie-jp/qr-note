import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { LEGACY_PIN_CACHE, MEDIA_CACHE, PIN_CACHE, SECRET_CACHE } from './cacheNames'

// public/sw.js の「撮影情報を抜いた後の掃除」(docs/113 §8-5) だけを確かめる。
// sw.js は素の JS で import できないので、self / caches / fetch を偽物に差し替えて
// 読み込み、登録された activate / fetch のハンドラを直接呼ぶ。

type Handler = (event: unknown) => void

class FakeCache {
  readonly entries = new Map<string, Response>()

  async match(request: Request | string): Promise<Response | undefined> {
    return this.entries.get(keyOf(request))
  }

  async put(request: Request | string, response: Response): Promise<void> {
    this.entries.set(keyOf(request), response)
  }

  async delete(request: Request | string): Promise<boolean> {
    return this.entries.delete(keyOf(request))
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url))
  }
}

function keyOf(request: Request | string): string {
  return typeof request === 'string' ? new URL(request, ORIGIN).href : request.url
}

const ORIGIN = 'https://qr.example.test'

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>()

  async open(name: string): Promise<FakeCache> {
    const store = this.stores.get(name) ?? new FakeCache()
    this.stores.set(name, store)
    return store
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()]
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name)
  }
}

const handlers = new Map<string, Handler>()
let storage: FakeCacheStorage
let fetchMock: ReturnType<typeof vi.fn>

async function loadWorker(): Promise<void> {
  vi.resetModules()
  handlers.clear()
  vi.stubGlobal('self', {
    location: new URL(`${ORIGIN}/sw.js?v=9.9.9`),
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  })
  // 変数経由にして tsc の型解決を避ける (sw.js は素の JS で、型を持たない)
  const swPath = '../../../public/sw.js'
  await import(/* @vite-ignore */ swPath)
}

async function activate(): Promise<void> {
  const waits: Promise<unknown>[] = []
  handlers.get('activate')?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) })
  await Promise.all(waits)
}

// fetch ハンドラを呼び、respondWith に渡された応答を待って返す。
// 保存 (waitUntil) も待つ
async function requestAsset(path: string): Promise<Response> {
  let responded: Promise<Response> | undefined
  const waits: Promise<unknown>[] = []
  handlers.get('fetch')?.({
    request: new Request(`${ORIGIN}${path}`),
    respondWith: (p: Promise<Response>) => {
      responded = p
    },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  })
  if (responded === undefined) {
    throw new Error('respondWith が呼ばれなかった')
  }
  const res = await responded
  await Promise.all(waits)
  return res
}

beforeEach(async () => {
  storage = new FakeCacheStorage()
  fetchMock = vi.fn(async () => new Response('fresh', { status: 200 }))
  vi.stubGlobal('caches', storage)
  vi.stubGlobal('fetch', fetchMock)
  await loadWorker()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('activate', () => {
  test('撮影情報を抜く前の添付の棚 (v1) と古い殻を捨て、現行の棚は残す', async () => {
    for (const name of [
      'qr-media-v1',
      'qr-shell-1.0.0',
      'qr-shell-9.9.9',
      'qr-media-v2',
      'qr-pin-v2',
      'qr-secret-v1',
    ]) {
      await storage.open(name)
    }

    await activate()

    expect((await storage.keys()).sort()).toEqual([
      'qr-media-v2',
      'qr-pin-v2',
      'qr-secret-v1',
      'qr-shell-9.9.9',
    ])
  })

  // 旧い持ち出しの棚は v2 が揃うまで唯一の圏外用の写し。ここで消すと、更新直後に
  // 圏外へ出た人の印付きノートの添付が消える (v2 を埋めるのは画面側の同期)
  test('旧い持ち出しの棚 (qr-pin-v1) は残す', async () => {
    await storage.open('qr-pin-v1')

    await activate()

    expect(await storage.keys()).toContain('qr-pin-v1')
  })

  // sw.js と cacheNames.ts は同じ名前を二重に持つ。片方だけ直すと、新しい棚が
  // activate のたびに黙って消える
  test('cacheNames.ts の棚はすべて activate で残る', async () => {
    const names = [MEDIA_CACHE, PIN_CACHE, SECRET_CACHE, LEGACY_PIN_CACHE]
    for (const name of names) {
      await storage.open(name)
    }

    await activate()

    expect(await storage.keys()).toEqual(expect.arrayContaining(names))
  })

  test('qr- で始まらない他所の棚には触らない', async () => {
    await storage.open('other-app-cache')

    await activate()

    expect(await storage.keys()).toContain('other-app-cache')
  })
})

describe('添付の取得', () => {
  test('原寸は棚に無ければ HTTP キャッシュを飛ばして取り直す', async () => {
    const res = await requestAsset('/api/images/a.jpg')

    expect(await res.text()).toBe('fresh')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'reload' })
  })

  test('サムネ (?thumb=1) は HTTP キャッシュを使う', async () => {
    await requestAsset('/api/images/a.jpg?thumb=1&v=4')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.cache).toBeUndefined()
  })

  test('取れた原寸は新しい棚 qr-media-v2 に入れる', async () => {
    await requestAsset('/api/images/a.jpg')

    const media = await storage.open('qr-media-v2')
    expect(await media.match(`${ORIGIN}/api/images/a.jpg`)).toBeDefined()
    expect(await storage.keys()).not.toContain('qr-media-v1')
  })

  test('棚にあれば取りに行かない', async () => {
    const media = await storage.open('qr-media-v2')
    await media.put(`${ORIGIN}/api/images/a.jpg`, new Response('cached'))

    const res = await requestAsset('/api/images/a.jpg')

    expect(await res.text()).toBe('cached')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('圏外での旧い持ち出しの棚', () => {
  test('v2 に無く圏外なら、旧い棚の写しを返す', async () => {
    const legacy = await storage.open('qr-pin-v1')
    await legacy.put(`${ORIGIN}/api/images/a.jpg`, new Response('legacy'))
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    const res = await requestAsset('/api/images/a.jpg')

    expect(await res.text()).toBe('legacy')
  })

  test('オンラインなら旧い棚は読まず、取り直す', async () => {
    const legacy = await storage.open('qr-pin-v1')
    await legacy.put(`${ORIGIN}/api/images/a.jpg`, new Response('legacy'))

    const res = await requestAsset('/api/images/a.jpg')

    expect(await res.text()).toBe('fresh')
  })
})
