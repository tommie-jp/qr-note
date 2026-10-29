import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadSearchPayload } from '@/lib/api/searchPayload'
import { reportServerLine } from '@/lib/logging/perfServer'

// 検索の口 GET /api/items (docs/123 §1-3)。
// 他の route テストと同じ流儀: next/headers とセッションだけを差し替えて
// 門番は本物を通す。中身の組み立て (searchPayload) は偽物にして、
// クエリの検め (searchParams) と封筒の形を見る
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
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
vi.mock('@/lib/api/searchPayload', () => ({ loadSearchPayload: vi.fn() }))
vi.mock('@/lib/logging/perfServer', () => ({ reportServerLine: vi.fn() }))

const { GET } = await import('./route')

const PAYLOAD = { items: [], circuitThumbs: {}, extras: null }
const META = { total: 41, page: 2, pageCount: 3 }

function request(query = '', headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/items${query}`, { headers })
}

const originalDemo = process.env.DEMO_MODE

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sessionToken = mocks.validToken
  delete process.env.DEMO_MODE
  vi.mocked(loadSearchPayload).mockResolvedValue({ payload: PAYLOAD, meta: META, perf: null })
})

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

describe('拒否系', () => {
  test('未ログインは 401 で、検索まで届かない', async () => {
    // Arrange
    mocks.sessionToken = null

    // Act
    const res = await GET(request('?q=抵抗'))

    // Assert
    expect(res.status).toBe(401)
    expect(loadSearchPayload).not.toHaveBeenCalled()
  })

  test('クロスサイトからは 403 (本文がまとめて出る口)', async () => {
    const res = await GET(request('', { 'sec-fetch-site': 'cross-site' }))

    expect(res.status).toBe(403)
    expect(loadSearchPayload).not.toHaveBeenCalled()
  })

  test.each([
    ['ページが 0', '?page=0'],
    ['ページが数でない', '?page=abc'],
    ['ページが上限超え', '?page=1001'],
    ['ページが小数', '?page=1.5'],
    ['検索語が長すぎる', `?q=${'a'.repeat(1001)}`],
  ])('%s なら 400', async (_label, query) => {
    const res = await GET(request(query))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('リクエストの形式が正しくありません')
    expect(loadSearchPayload).not.toHaveBeenCalled()
  })
})

describe('成功', () => {
  test('デモでも開いていて、ページ付きの封筒で返す', async () => {
    process.env.DEMO_MODE = '1'

    const res = await GET(request('?q=%20抵抗%20&page=2&sort=title&view=image'))

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe(
      JSON.stringify({ success: true, data: PAYLOAD, error: null, meta: META }),
    )
    expect(loadSearchPayload).toHaveBeenCalledWith({
      query: '抵抗',
      page: 2,
      through: 1,
      sort: 'title',
      view: 'image',
    })
  })

  test('through で 1 ページ目から読み進めた所までをまとめて引く (書き込み後の取り直し)', async () => {
    await GET(request('?through=4'))

    expect(loadSearchPayload).toHaveBeenCalledWith(expect.objectContaining({ page: 1, through: 4 }))
  })

  test.each([
    ['続きのページと混ぜる', '?page=2&through=3'],
    ['数でない', '?through=abc'],
    ['0 ページ', '?through=0'],
  ])('through の形が違えば 400: %s', async (_label, search) => {
    const res = await GET(request(search))

    expect(res.status).toBe(400)
    expect(loadSearchPayload).not.toHaveBeenCalled()
  })

  test('並び順と表示モードの判らない値は既定に畳む (400 にしない)', async () => {
    await GET(request('?sort=random&view=huge'))

    expect(loadSearchPayload).toHaveBeenCalledWith({
      query: '',
      page: 1,
      through: 1,
      sort: 'updated',
      view: 'compact',
    })
  })

  test('計測中は Server-Timing を付けて計測ログに 1 行出す', async () => {
    const perf = { totalMs: 12, phases: { 検索: 8 } }
    vi.mocked(loadSearchPayload).mockResolvedValue({ payload: PAYLOAD, meta: META, perf })

    const res = await GET(request())

    expect(res.headers.get('server-timing')).not.toBeNull()
    expect(reportServerLine).toHaveBeenCalledWith(
      '検索/API',
      [
        ['page', 2],
        ['件数', '0/41'],
      ],
      perf,
    )
  })

  test('計測していなければ Server-Timing は付けない', async () => {
    const res = await GET(request())

    expect(res.headers.get('server-timing')).toBeNull()
    expect(reportServerLine).not.toHaveBeenCalled()
  })
})
