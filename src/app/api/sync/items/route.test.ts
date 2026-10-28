import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// オフライン用にノートをまるごと持ち出す口 (docs/65-オフライン対応計画.md §1)。
// 他の route テストと同じ流儀: next/headers とセッションの DB を差し替え、
// 門番の判定そのものは本物を通す。持ち出す中身 (syncItems) は偽物
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  loads: 0,
  payload: { syncedAt: '2026-09-13T00:00:00.000Z', items: [], circuits: [] },
}))

vi.mock('next/headers', async () => {
  const { SESSION_COOKIE_NAME } = await import('@/lib/auth/sessionToken')
  return {
    headers: async () => new Headers(),
    cookies: async () => ({
      get: (name: string) =>
        name === SESSION_COOKIE_NAME && mocks.sessionToken !== null
          ? { name, value: mocks.sessionToken }
          : undefined,
    }),
  }
})

vi.mock('@/lib/auth/sessionStore', () => ({
  findActiveSession: async (token: string) =>
    token === mocks.validToken
      ? { userName: 'tommie', expiresAt: new Date('2099-01-01T00:00:00.000Z') }
      : null,
}))

vi.mock('@/lib/offline/syncItems', () => ({
  loadOfflineSyncPayload: async () => {
    mocks.loads += 1
    return mocks.payload
  },
}))

// 版 (ETag) は本文を組む前の安い問い合わせ 1 本で決まる (docs/118 §4-2)
vi.mock('@/lib/offline/syncVersion', () => ({
  loadSyncEtag: async () => '"v-1"',
}))

const { GET } = await import('./route')

function syncRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/sync/items', { headers })
}

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.loads = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('拒否系 (読み出す前に弾く)', () => {
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await GET(syncRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
    expect(mocks.loads).toBe(0)
  })

  // Service Worker が「同期の失敗」と分かるよう、未ログインは必ず 401
  test('未ログインはクロスサイト判定より先に 401', async () => {
    mocks.sessionToken = null

    const res = await GET(syncRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
    expect(mocks.loads).toBe(0)
  })

  test('クロスサイトは 403', async () => {
    const res = await GET(syncRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.loads).toBe(0)
  })
})

// 中間キャッシュに持たれると、別の端末で足したノートがいつまでも届かない。
// 版 (etag) は本文にも載せ、端末が写しに残して次の If-None-Match に使う
test('中身をキャッシュさせずに返し、ETag を本文とヘッダの両方に載せる', async () => {
  const res = await GET(syncRequest({ 'sec-fetch-site': 'same-origin' }))

  expect(await responseContract(res)).toEqual(
    jsonContract(200, okEnvelope({ ...mocks.payload, etag: '"v-1"' })),
  )
  expect(res.headers.get('ETag')).toBe('"v-1"')
  expect(mocks.loads).toBe(1)
})

// 変化が無ければ本文を組まずに 304 (docs/118 §4-2)
describe('変化が無ければ 304', () => {
  test('同じ版を If-None-Match で送ってきたら、本文を読まずに 304', async () => {
    const res = await GET(syncRequest({ 'sec-fetch-site': 'same-origin', 'if-none-match': '"v-1"' }))

    expect(res.status).toBe(304)
    expect(res.headers.get('ETag')).toBe('"v-1"')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toBe('')
    expect(mocks.loads).toBe(0)
  })

  test('違う版なら本文を返す', async () => {
    const res = await GET(syncRequest({ 'sec-fetch-site': 'same-origin', 'if-none-match': '"v-0"' }))

    expect(res.status).toBe(200)
    expect(mocks.loads).toBe(1)
  })
})

// 本文は gzip で返す (docs/118 §4-1)。展開すれば素の封筒と同じ
test('gzip を受ける相手には圧縮して返す', async () => {
  const { gunzipSync } = await import('node:zlib')
  const res = await GET(syncRequest({ 'sec-fetch-site': 'same-origin', 'accept-encoding': 'gzip' }))

  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Encoding')).toBe('gzip')
  expect(res.headers.get('Cache-Control')).toBe('no-store')
  const body = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8')
  expect(JSON.parse(body)).toEqual(okEnvelope({ ...mocks.payload, etag: '"v-1"' }))
})

// 速度計測中 (docs/119 §2-3)。中身は同じで、Server-Timing と計測行が増えるだけ
describe('速度計測中', () => {
  afterEach(async () => {
    const { setPerfLogEnabled } = await import('@/lib/logging/perfSwitch')
    const { clearPerfLines } = await import('@/lib/logging/buffer')
    setPerfLogEnabled(false)
    clearPerfLines()
    vi.restoreAllMocks()
  })

  test('中身は変えず、Server-Timing に ASCII の段階を載せ、計測行を積む', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { setPerfLogEnabled } = await import('@/lib/logging/perfSwitch')
    const { recentPerfLines } = await import('@/lib/logging/buffer')
    setPerfLogEnabled(true)

    const res = await GET(syncRequest({ 'sec-fetch-site': 'same-origin' }))

    expect(res.headers.get('Server-Timing')).toMatch(/^etag;dur=\d+, db;dur=\d+, json;dur=\d+$/)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ ...mocks.payload, etag: '"v-1"' })),
    )
    const [line] = recentPerfLines()
    expect(line.text).toMatch(
      /^\[計測\] 同期\/サーバ 結果=200 件数=0 回路=0 rss=\d+MB heap=\d+MB サーバ=\d+ms\(etag=\d+ db=\d+ json=\d+\)$/,
    )
  })

  test('計測していなければ Server-Timing を付けない', async () => {
    const res = await GET(syncRequest({ 'sec-fetch-site': 'same-origin' }))
    expect(res.headers.get('Server-Timing')).toBeNull()
  })
})
