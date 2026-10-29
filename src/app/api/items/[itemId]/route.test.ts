import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { toItemDto } from '@/lib/api/itemDto'
import { INTERNAL_ERROR_MESSAGE } from '@/lib/api/runCommand'
import { CommandError } from '@/lib/commands/commandError'
import { saveNote } from '@/lib/commands/noteCommands'
import { getItem } from '@/lib/items/read'
import { MAX_TEXT_LENGTH } from '@/lib/validation'

// ノート 1 件の口 GET / PUT /api/items/:itemId (docs/123 §1-3・§2-2)。
// 門番は本物 (next/headers とセッションだけ差し替え)。書く本体
// (noteCommands.saveNote) と DB の読み (items/read) は偽物にして、
// 「門番 → id → 本文の検め → 本体 → 封筒」の順と形を見る。
// 本体の振る舞いそのものは lib/commands/noteCommands.test.ts
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
vi.mock('@/lib/items/read', () => ({ getItem: vi.fn() }))
vi.mock('@/lib/commands/noteCommands', () => ({ saveNote: vi.fn() }))

const { GET, PUT } = await import('./route')

const ID = '00000000-0000-7000-8000-000000000001'
const ITEM: Item = {
  itemId: ID,
  memo: '本文',
  title: '本文',
  tags: [],
  props: [],
  taskTodo: 0,
  taskDone: 0,
  createdAt: new Date(1_000),
  updatedAt: new Date(2_000),
  accessedAt: new Date(2_000),
  deletedAt: null,
  publicAt: null,
  offlinePin: false,
}

function context(itemId = ID) {
  return { params: Promise.resolve({ itemId }) }
}

function request(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost/api/items/${ID}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const VALID_SAVE = { memo: '新しい本文', base: '2000' }
const originalDemo = process.env.DEMO_MODE

beforeEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  mocks.sessionToken = mocks.validToken
  delete process.env.DEMO_MODE
  vi.mocked(getItem).mockResolvedValue(null)
})

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

describe('GET', () => {
  test('ノートを DTO にして返す', async () => {
    // Arrange
    vi.mocked(getItem).mockResolvedValue(ITEM)

    // Act
    const res = await GET(request('GET'), context())

    // Assert
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      data: { item: toItemDto(ITEM) },
      error: null,
    })
  })

  test('未登録の id は 200 で item: null (QR シールを先に貼れる)', async () => {
    const res = await GET(request('GET'), context())

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ item: null })
  })

  test('未ログインは 401 で、id の検めより先', async () => {
    mocks.sessionToken = null

    const res = await GET(request('GET'), context('../x'))

    expect(res.status).toBe(401)
    expect(getItem).not.toHaveBeenCalled()
  })

  test('クロスサイトからは 403', async () => {
    const res = await GET(request('GET', undefined, { 'sec-fetch-site': 'cross-site' }), context())

    expect(res.status).toBe(403)
  })

  test('形の悪い id は 400 で、DB を引かない', async () => {
    const res = await GET(request('GET'), context('../x'))

    expect(res.status).toBe(400)
    expect(getItem).not.toHaveBeenCalled()
  })
})

describe('PUT (保存)', () => {
  test('検めた本文と基点で本体を呼び、書いたノートを返す', async () => {
    vi.mocked(saveNote).mockResolvedValue({ ok: true, item: ITEM })

    const res = await PUT(request('PUT', { ...VALID_SAVE, checkpoint: true }), context())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { item: toItemDto(ITEM) }, error: null })
    expect(saveNote).toHaveBeenCalledWith(
      ID,
      '新しい本文',
      { kind: 'at', at: new Date(2_000) },
      true,
    )
  })

  test('checkpoint は true のときだけ立てる', async () => {
    vi.mocked(saveNote).mockResolvedValue({ ok: true, item: ITEM })

    await PUT(request('PUT', { ...VALID_SAVE, checkpoint: 'yes' }), context())

    expect(vi.mocked(saveNote).mock.calls[0][3]).toBe(false)
  })

  test('競合は 409 で、いまのサーバの版を data.state に載せる', async () => {
    const state = {
      seq: 1,
      kind: 'conflict' as const,
      server: { memo: '別の本文', updatedAt: 3_000, deletedAt: null },
    }
    vi.mocked(saveNote).mockResolvedValue({ ok: false, state })

    const res = await PUT(request('PUT', VALID_SAVE), context())

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      success: false,
      data: { state },
      error: 'ほかの画面で書き換えられています',
    })
  })

  test.each([
    ['基点が無い', { memo: '本文' }],
    ['基点が読めない', { memo: '本文', base: 'latest' }],
    ['基点が数値型', { memo: '本文', base: 2000 }],
    ['本文が無い', { base: '2000' }],
    ['本文が上限を超える', { memo: 'あ'.repeat(MAX_TEXT_LENGTH + 1), base: '2000' }],
    ['壊れた JSON', '{'],
    ['配列', '[]'],
  ])('%s なら 400 で、書かない', async (_label, body) => {
    const res = await PUT(request('PUT', body), context())

    expect(res.status).toBe(400)
    expect(saveNote).not.toHaveBeenCalled()
  })

  test('未ログインは 401 で、本文を読む前に断る', async () => {
    mocks.sessionToken = null

    const res = await PUT(request('PUT', '{'), context())

    expect(res.status).toBe(401)
    expect(saveNote).not.toHaveBeenCalled()
  })

  test('クロスサイトからは 403', async () => {
    const res = await PUT(
      request('PUT', VALID_SAVE, { 'sec-fetch-site': 'cross-site' }),
      context(),
    )

    expect(res.status).toBe(403)
    expect(saveNote).not.toHaveBeenCalled()
  })

  test('形の悪い id は 400', async () => {
    const res = await PUT(request('PUT', VALID_SAVE), context('../x'))

    expect(res.status).toBe(400)
    expect(saveNote).not.toHaveBeenCalled()
  })

  test('デモでも保存はできる (編集を試せるのがデモの役目)', async () => {
    process.env.DEMO_MODE = '1'
    vi.mocked(saveNote).mockResolvedValue({ ok: true, item: ITEM })

    const res = await PUT(request('PUT', VALID_SAVE), context())

    expect(res.status).toBe(200)
  })

  test('本体の CommandError はその状態コードで返す', async () => {
    vi.mocked(saveNote).mockRejectedValue(new CommandError(404, 'ノートが見つかりません'))

    const res = await PUT(request('PUT', VALID_SAVE), context())

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('ノートが見つかりません')
  })

  test('想定外の例外は 500 の定型文で、中身を漏らさない', async () => {
    vi.mocked(saveNote).mockRejectedValue(new Error('prisma: P1001 db.internal:5432'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await PUT(request('PUT', VALID_SAVE), context())

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, data: null, error: INTERNAL_ERROR_MESSAGE })
  })
})
