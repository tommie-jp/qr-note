import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { toItemDto } from '@/lib/api/itemDto'
import { INTERNAL_ERROR_MESSAGE } from '@/lib/api/runCommand'
import { loadCircuitThumbs } from '@/lib/circuit/thumbs'
import { applyTrashOp } from '@/lib/commands/bulkCommands'
import { listTrashedItems } from '@/lib/items/trash'

// ゴミ箱の口 GET / POST /api/trash (docs/12・docs/123 §2-1)。
// 門番は本物 (next/headers とセッションだけ差し替え)。書く本体
// (bulkCommands.applyTrashOp) と DB の読みは偽物。id の並びの検め
// (itemIds) は本物を通す
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
vi.mock('@/lib/commands/bulkCommands', () => ({ applyTrashOp: vi.fn() }))
vi.mock('@/lib/items/trash', () => ({ listTrashedItems: vi.fn() }))
vi.mock('@/lib/circuit/thumbs', () => ({ loadCircuitThumbs: vi.fn() }))

const { GET, POST } = await import('./route')

const ID1 = '00000000-0000-7000-8000-000000000001'
const ID2 = '00000000-0000-7000-8000-000000000002'
const TRASHED = {
  itemId: ID1,
  memo: '本文',
  title: '',
  tags: [],
  props: [],
  taskTodo: 0,
  taskDone: 0,
  createdAt: new Date(1_000),
  updatedAt: new Date(2_000),
  accessedAt: new Date(2_000),
  deletedAt: new Date(3_000),
  publicAt: null,
  offlinePin: false,
} satisfies Item

function request(method: string, body?: unknown, query = '', headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/trash${query}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const originalDemo = process.env.DEMO_MODE

beforeEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  mocks.sessionToken = mocks.validToken
  delete process.env.DEMO_MODE
  vi.mocked(listTrashedItems).mockResolvedValue([TRASHED])
  vi.mocked(loadCircuitThumbs).mockResolvedValue({})
})

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

describe('GET (一覧)', () => {
  test('ゴミ箱のノートを DTO にし、回路図の見本を添えて返す', async () => {
    // Act
    const res = await GET(request('GET'))

    // Assert
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      data: { items: [toItemDto(TRASHED)], circuitThumbs: {} },
      error: null,
    })
    expect(listTrashedItems).toHaveBeenCalledWith('deleted')
    expect(loadCircuitThumbs).toHaveBeenCalledWith([TRASHED], 'first')
  })

  test('?sort= と ?view=image を効かせ、判らない並びは削除順に畳む', async () => {
    await GET(request('GET', undefined, '?sort=title&view=image'))
    await GET(request('GET', undefined, '?sort=random'))

    expect(vi.mocked(listTrashedItems).mock.calls).toEqual([['title'], ['deleted']])
    expect(vi.mocked(loadCircuitThumbs).mock.calls[0][1]).toBe('all')
  })

  test('未ログインは 401 で、DB を引かない', async () => {
    mocks.sessionToken = null

    expect((await GET(request('GET'))).status).toBe(401)
    expect(listTrashedItems).not.toHaveBeenCalled()
  })

  test('クロスサイトからは 403', async () => {
    const res = await GET(request('GET', undefined, '', { 'sec-fetch-site': 'cross-site' }))

    expect(res.status).toBe(403)
  })
})

describe('POST (出し入れ)', () => {
  test.each(['trash', 'restore', 'purge'] as const)(
    '%s は検めた id の並びで本体を呼び、件数を返す',
    async (op) => {
      const res = await POST(request('POST', { op, itemIds: [ID1, '../x', ID2, ID1] }))

      expect(applyTrashOp).toHaveBeenCalledWith(op, [ID1, ID2])
      expect(await res.json()).toEqual({ success: true, data: { count: 2 }, error: null })
    },
  )

  test('empty は id を取らない (送られても無視する)', async () => {
    const res = await POST(request('POST', { op: 'empty', itemIds: [ID1] }))

    expect(applyTrashOp).toHaveBeenCalledWith('empty', [])
    expect((await res.json()).data).toEqual({ count: 0 })
  })

  test('デモでも使える', async () => {
    process.env.DEMO_MODE = '1'

    expect((await POST(request('POST', { op: 'trash', itemIds: [ID1] }))).status).toBe(200)
  })

  test.each([
    ['op が無い', { itemIds: [ID1] }],
    ['op が知らない値', { op: 'burn', itemIds: [ID1] }],
    ['itemIds が配列でない', { op: 'trash', itemIds: ID1 }],
    ['itemIds が無い', { op: 'purge' }],
    ['壊れた JSON', '{'],
  ])('%s なら 400 で、書かない', async (_label, body) => {
    expect((await POST(request('POST', body))).status).toBe(400)
    expect(applyTrashOp).not.toHaveBeenCalled()
  })

  test('未ログインは 401 で、本文を読む前に断る', async () => {
    mocks.sessionToken = null

    expect((await POST(request('POST', '{'))).status).toBe(401)
    expect(applyTrashOp).not.toHaveBeenCalled()
  })

  test('クロスサイトからは 403', async () => {
    const res = await POST(
      request('POST', { op: 'empty' }, '', { 'sec-fetch-site': 'cross-site' }),
    )

    expect(res.status).toBe(403)
    expect(applyTrashOp).not.toHaveBeenCalled()
  })

  test('想定外の例外は 500 の定型文', async () => {
    vi.mocked(applyTrashOp).mockRejectedValue(new Error('pg down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(request('POST', { op: 'empty' }))

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe(INTERNAL_ERROR_MESSAGE)
  })
})
