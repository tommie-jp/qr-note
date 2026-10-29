import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CommandError } from '@/lib/commands/commandError'
import { applyBulkTags, setOfflinePins } from '@/lib/commands/bulkCommands'

// 選んだノートをまとめて書き換える口 (PUT /api/items/pin・POST /api/items/tags)。
// 門番は本物 (next/headers とセッションだけ差し替え)。書く本体は偽物で、
// id の並びの検め (itemIds) とタグの読み (tags/bulk) は本物を通す
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
vi.mock('@/lib/commands/bulkCommands', () => ({ applyBulkTags: vi.fn(), setOfflinePins: vi.fn() }))

const pin = await import('./pin/route')
const tags = await import('./tags/route')

const ID1 = '00000000-0000-7000-8000-000000000001'
const ID2 = '00000000-0000-7000-8000-000000000002'

function request(method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/items/x', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const originalDemo = process.env.DEMO_MODE

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sessionToken = mocks.validToken
  delete process.env.DEMO_MODE
})

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

describe('PUT /api/items/pin (オフラインの印)', () => {
  test('検めた id の並びと望む状態で本体を呼び、件数を返す', async () => {
    // Act
    const res = await pin.PUT(request('PUT', { itemIds: [ID1, ID1, '../x', ID2], pinned: true }))

    // Assert
    expect(setOfflinePins).toHaveBeenCalledWith([ID1, ID2], true)
    expect(await res.json()).toEqual({ success: true, data: { count: 2 }, error: null })
  })

  test('デモでは、ログインより先に 403 で断る (同期の口ごと閉じている)', async () => {
    process.env.DEMO_MODE = '1'
    mocks.sessionToken = null

    const res = await pin.PUT(request('PUT', { itemIds: [ID1], pinned: true }))

    expect(res.status).toBe(403)
    expect(setOfflinePins).not.toHaveBeenCalled()
  })

  test('未ログインは 401', async () => {
    mocks.sessionToken = null

    expect((await pin.PUT(request('PUT', { itemIds: [ID1], pinned: true }))).status).toBe(401)
  })

  test('クロスサイトからは 403', async () => {
    const res = await pin.PUT(
      request('PUT', { itemIds: [ID1], pinned: true }, { 'sec-fetch-site': 'cross-site' }),
    )

    expect(res.status).toBe(403)
    expect(setOfflinePins).not.toHaveBeenCalled()
  })

  test.each([
    ['pinned が真偽値でない', { itemIds: [ID1], pinned: '1' }],
    ['itemIds が無い', { pinned: true }],
    ['壊れた JSON', '{'],
  ])('%s なら 400', async (_label, body) => {
    expect((await pin.PUT(request('PUT', body))).status).toBe(400)
    expect(setOfflinePins).not.toHaveBeenCalled()
  })
})

describe('POST /api/items/tags (一括タグ)', () => {
  test('入力をタグに読み、本体へ渡す', async () => {
    const res = await tags.POST(
      request('POST', { mode: 'add', itemIds: [ID1, ID2], tags: '#英単語 #TOEIC' }),
    )

    expect(applyBulkTags).toHaveBeenCalledWith('add', [ID1, ID2], ['英単語', 'toeic'])
    expect(await res.json()).toEqual({ success: true, data: { count: 2 }, error: null })
  })

  test('remove も同じ形で渡す', async () => {
    await tags.POST(request('POST', { mode: 'remove', itemIds: [ID1], tags: '英単語' }))

    expect(applyBulkTags).toHaveBeenCalledWith('remove', [ID1], ['英単語'])
  })

  test('デモでも使える', async () => {
    process.env.DEMO_MODE = '1'

    const res = await tags.POST(request('POST', { mode: 'add', itemIds: [ID1], tags: '#a' }))

    expect(res.status).toBe(200)
  })

  test.each([
    ['mode が知らない値', { mode: 'toggle', itemIds: [ID1], tags: '#a' }],
    ['tags が文字列でない', { mode: 'add', itemIds: [ID1], tags: ['a'] }],
    ['itemIds が配列でない', { mode: 'add', itemIds: null, tags: '#a' }],
    ['壊れた JSON', '{'],
  ])('%s なら 400', async (_label, body) => {
    expect((await tags.POST(request('POST', body))).status).toBe(400)
    expect(applyBulkTags).not.toHaveBeenCalled()
  })

  test('未ログインは 401、クロスサイトは 403', async () => {
    const body = { mode: 'add', itemIds: [ID1], tags: '#a' }
    const crossSite = await tags.POST(request('POST', body, { 'sec-fetch-site': 'cross-site' }))
    mocks.sessionToken = null
    const loggedOut = await tags.POST(request('POST', body))

    expect(crossSite.status).toBe(403)
    expect(loggedOut.status).toBe(401)
    expect(applyBulkTags).not.toHaveBeenCalled()
  })

  test('本体の CommandError はその状態コードで返す', async () => {
    vi.mocked(applyBulkTags).mockRejectedValue(new CommandError(400, '本文が長すぎます'))

    const res = await tags.POST(request('POST', { mode: 'add', itemIds: [ID1], tags: '#a' }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('本文が長すぎます')
  })
})
