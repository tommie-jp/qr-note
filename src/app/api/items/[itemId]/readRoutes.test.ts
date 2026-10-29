import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { loadNoteCircuits, loadNoteRender } from '@/lib/api/notePayload'
import { recordAccess } from '@/lib/commands/noteCommands'
import { findListNeighbors, getItem } from '@/lib/items/read'

// /api/items/:itemId の下の読む口 (render・circuits・neighbors) と、
// 開いた記録 (access)。門番は本物 (next/headers とセッションだけ差し替え)。
// 描画材料 (notePayload) と DB の読みは偽物。前後の解決 (itemListContext)
// は本物を通し、その先の検索 (findListNeighbors) だけを差し替える
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  sortCookie: undefined as string | undefined,
}))

vi.mock('next/headers', async () => {
  const { SESSION_COOKIE_NAME } = await import('@/lib/auth/sessionToken')
  return {
    headers: async () => new Headers(),
    cookies: async () => ({
      get: (name: string) => {
        if (name === SESSION_COOKIE_NAME && mocks.sessionToken !== null) {
          return { name, value: mocks.sessionToken }
        }
        if (name === 'sort' && mocks.sortCookie !== undefined) {
          return { name, value: mocks.sortCookie }
        }
        return undefined
      },
    }),
  }
})
vi.mock('@/lib/auth/sessionStore', () => ({
  findActiveSession: async (token: string) =>
    token === mocks.validToken
      ? { userName: 'tommie', expiresAt: new Date('2099-01-01T00:00:00.000Z') }
      : null,
}))
vi.mock('@/lib/items/read', () => ({ getItem: vi.fn(), findListNeighbors: vi.fn() }))
vi.mock('@/lib/api/notePayload', () => ({ loadNoteRender: vi.fn(), loadNoteCircuits: vi.fn() }))
vi.mock('@/lib/commands/noteCommands', () => ({ recordAccess: vi.fn() }))

const render = await import('./render/route')
const circuits = await import('./circuits/route')
const neighbors = await import('./neighbors/route')
const access = await import('./access/route')

const ID = '00000000-0000-7000-8000-000000000001'
const PREV = '00000000-0000-7000-8000-000000000000'
const ITEM = { itemId: ID, memo: '```circuit\nR1\n```' } as Item

type Handler = (request: Request, context: { params: Promise<{ itemId: string }> }) => Promise<Response>

function call(
  handler: Handler,
  { method = 'GET', itemId = ID, query = '', headers = {} as Record<string, string> } = {},
): Promise<Response> {
  return handler(new Request(`http://localhost/api/items/${itemId}${query}`, { method, headers }), {
    params: Promise.resolve({ itemId }),
  })
}

const originalDemo = process.env.DEMO_MODE

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sessionToken = mocks.validToken
  mocks.sortCookie = undefined
  delete process.env.DEMO_MODE
  vi.mocked(getItem).mockResolvedValue(null)
  vi.mocked(loadNoteRender).mockResolvedValue({ matrices: [], health: [], attachmentBytes: 0 })
  vi.mocked(loadNoteCircuits).mockResolvedValue({ circuits: [] })
  vi.mocked(findListNeighbors).mockResolvedValue({ prev: PREV, next: null })
})

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

const ALL: ReadonlyArray<[string, Handler, string]> = [
  ['render', render.GET, 'GET'],
  ['circuits', circuits.GET, 'GET'],
  ['neighbors', neighbors.GET, 'GET'],
  ['access', access.POST, 'POST'],
]

describe.each(ALL)('%s の門番', (_name, handler, method) => {
  test('未ログインは 401', async () => {
    // Arrange
    mocks.sessionToken = null

    // Act
    const res = await call(handler, { method })

    // Assert
    expect(res.status).toBe(401)
    expect(getItem).not.toHaveBeenCalled()
    expect(recordAccess).not.toHaveBeenCalled()
  })

  test('クロスサイトからは 403', async () => {
    const res = await call(handler, { method, headers: { 'sec-fetch-site': 'cross-site' } })

    expect(res.status).toBe(403)
  })

  test('形の悪い id は 400', async () => {
    const res = await call(handler, { method, itemId: 'not-a-uuid' })

    expect(res.status).toBe(400)
    expect(getItem).not.toHaveBeenCalled()
    expect(recordAccess).not.toHaveBeenCalled()
  })

  test('デモでも開いている', async () => {
    process.env.DEMO_MODE = '1'

    expect((await call(handler, { method })).status).toBe(200)
  })
})

describe('render', () => {
  test('ノートの本文から描画材料を組んで返す', async () => {
    vi.mocked(getItem).mockResolvedValue(ITEM)
    const payload = { matrices: [], health: [], attachmentBytes: 1234 }
    vi.mocked(loadNoteRender).mockResolvedValue(payload)

    const res = await call(render.GET)

    expect(loadNoteRender).toHaveBeenCalledWith(ITEM.memo, { bytesOnly: false })
    expect(await res.json()).toEqual({ success: true, data: payload, error: null })
  })

  test('未登録のノートは空の本文として組む', async () => {
    await call(render.GET)

    expect(loadNoteRender).toHaveBeenCalledWith('', { bytesOnly: false })
  })

  test('?only=bytes は添付量だけを組ませる', async () => {
    vi.mocked(getItem).mockResolvedValue(ITEM)

    await call(render.GET, { query: '/render?only=bytes' })

    expect(loadNoteRender).toHaveBeenCalledWith(ITEM.memo, { bytesOnly: true })
  })
})

describe('circuits', () => {
  test('ノートの回路図を描き終えて返す', async () => {
    vi.mocked(getItem).mockResolvedValue(ITEM)
    const payload = { circuits: [['k1', { ok: true, svg: '<svg/>' }]] } as unknown as Awaited<
      ReturnType<typeof loadNoteCircuits>
    >
    vi.mocked(loadNoteCircuits).mockResolvedValue(payload)

    const res = await call(circuits.GET)

    expect(loadNoteCircuits).toHaveBeenCalledWith(ITEM.memo)
    expect((await res.json()).data).toEqual(payload)
  })
})

describe('neighbors', () => {
  test('検索語があれば前後を引き、解決した検索語と並びを添える', async () => {
    const res = await call(neighbors.GET, { query: '?q=%20抵抗%20&sort=title' })

    expect(findListNeighbors).toHaveBeenCalledWith('抵抗', 'title', ID)
    expect((await res.json()).data).toEqual({ prev: PREV, next: null, query: '抵抗', sort: 'title' })
  })

  test('?sort= が無ければ cookie の並びを使う', async () => {
    mocks.sortCookie = 'accessed'

    await call(neighbors.GET, { query: '?q=abc' })

    expect(findListNeighbors).toHaveBeenCalledWith('abc', 'accessed', ID)
  })

  test('検索語が無ければ前後とも null で、検索しない', async () => {
    const res = await call(neighbors.GET)

    expect(findListNeighbors).not.toHaveBeenCalled()
    expect((await res.json()).data).toEqual({ prev: null, next: null, query: '', sort: 'updated' })
  })

  test('検索語が長すぎれば 400', async () => {
    const res = await call(neighbors.GET, { query: `?q=${'a'.repeat(1001)}` })

    expect(res.status).toBe(400)
    expect(findListNeighbors).not.toHaveBeenCalled()
  })
})

describe('access', () => {
  test('開いたことを記録して 200 の空を返す', async () => {
    const res = await call(access.POST, { method: 'POST' })

    expect(recordAccess).toHaveBeenCalledWith(ID)
    expect(await res.json()).toEqual({ success: true, data: {}, error: null })
  })
})
