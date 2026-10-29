import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Item } from '@/generated/prisma/client'
import { toItemDto } from '@/lib/api/itemDto'
import { INTERNAL_ERROR_MESSAGE } from '@/lib/api/runCommand'
import { CommandError } from '@/lib/commands/commandError'
import { commitNoteVersion, restoreNoteVersion } from '@/lib/commands/historyCommands'
import {
  assignNoteNumber,
  recordHealth,
  setNotePublic,
  toggleTask,
} from '@/lib/commands/noteCommands'
import { MAX_TEXT_LENGTH } from '@/lib/validation'

// /api/items/:itemId の下の書く口 (tasks・health・number・public・history)。
// もとは Server Action の門番の順 (ログイン → デモ拒否 → 入力) を
// app/actions.test.ts が押さえていた。いまは route の門番 (本物) が持つので
// ここで押さえ直す。書く本体 (lib/commands) は偽物 — 振る舞いは
// lib/commands/*.test.ts が見る
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
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
vi.mock('@/lib/commands/noteCommands', () => ({
  assignNoteNumber: vi.fn(),
  recordHealth: vi.fn(),
  setNotePublic: vi.fn(),
  toggleTask: vi.fn(),
}))
vi.mock('@/lib/commands/historyCommands', () => ({
  commitNoteVersion: vi.fn(),
  restoreNoteVersion: vi.fn(),
}))

const tasks = await import('./tasks/route')
const health = await import('./health/route')
const number = await import('./number/route')
const publicRoute = await import('./public/route')
const history = await import('./history/route')

const ID = '00000000-0000-7000-8000-000000000001'
const OID = 'a'.repeat(40)
const ITEM = {
  itemId: ID,
  memo: '本文',
  title: '',
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
} satisfies Item
const ITEM_ENVELOPE = { success: true, data: { item: toItemDto(ITEM) }, error: null }

type Handler = (request: Request, context: { params: Promise<{ itemId: string }> }) => Promise<Response>

function call(
  handler: Handler,
  method: string,
  body?: unknown,
  { itemId = ID, headers = {} as Record<string, string> } = {},
): Promise<Response> {
  const request = new Request(`http://localhost/api/items/${itemId}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  return handler(request, { params: Promise.resolve({ itemId }) })
}

const HEALTH = { date: '2026-09-14', item: '体重', values: [66.4], unit: 'kg' }

// 口ごとの「通る本文」と、デモで閉じるか
const ROUTES: ReadonlyArray<[string, Handler, string, unknown, boolean]> = [
  ['tasks', tasks.PATCH, 'PATCH', { line: 2, checked: true }, false],
  ['health', health.POST, 'POST', HEALTH, false],
  ['number', number.POST, 'POST', undefined, true],
  ['public', publicRoute.PUT, 'PUT', { isPublic: true }, true],
  ['history', history.POST, 'POST', { op: 'commit', message: 'm' }, true],
]

const ALL_COMMANDS = [
  toggleTask,
  recordHealth,
  assignNoteNumber,
  setNotePublic,
  commitNoteVersion,
  restoreNoteVersion,
]

function expectNothingWritten(): void {
  for (const command of ALL_COMMANDS) {
    expect(command).not.toHaveBeenCalled()
  }
}

const originalDemo = process.env.DEMO_MODE

beforeEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  mocks.sessionToken = mocks.validToken
  delete process.env.DEMO_MODE
  vi.mocked(toggleTask).mockResolvedValue(ITEM)
  vi.mocked(recordHealth).mockResolvedValue(ITEM)
  vi.mocked(assignNoteNumber).mockResolvedValue(ITEM)
  vi.mocked(setNotePublic).mockResolvedValue(ITEM)
  vi.mocked(commitNoteVersion).mockResolvedValue('committed')
  vi.mocked(restoreNoteVersion).mockResolvedValue(ITEM)
})

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

describe.each(ROUTES)('%s の門番', (_name, handler, method, body, demoDenied) => {
  test('未ログインは 401 で、本体まで届かない', async () => {
    // Arrange
    mocks.sessionToken = null

    // Act
    const res = await call(handler, method, body)

    // Assert
    expect(res.status).toBe(401)
    expectNothingWritten()
  })

  test('クロスサイトからは 403', async () => {
    const res = await call(handler, method, body, { headers: { 'sec-fetch-site': 'cross-site' } })

    expect(res.status).toBe(403)
    expectNothingWritten()
  })

  test('形の悪い id は 400', async () => {
    const res = await call(handler, method, body, { itemId: '../1' })

    expect(res.status).toBe(400)
    expectNothingWritten()
  })

  test(`デモでは${demoDenied ? '、ログインより先に 403 で断る' : 'も通る'}`, async () => {
    process.env.DEMO_MODE = '1'
    mocks.sessionToken = demoDenied ? null : mocks.validToken

    const res = await call(handler, method, body, { itemId: demoDenied ? '../1' : ID })

    expect(res.status).toBe(demoDenied ? 403 : 200)
  })

  test('通れば書いた結果を封筒で返す', async () => {
    const res = await call(handler, method, body)

    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })
})

describe('tasks', () => {
  test('行と望む状態を本体へ渡し、書いたノートを返す', async () => {
    const res = await call(tasks.PATCH, 'PATCH', { line: 2, checked: false })

    expect(toggleTask).toHaveBeenCalledWith(ID, 2, false)
    expect(await res.json()).toEqual(ITEM_ENVELOPE)
  })

  test.each([
    ['行が 0', { line: 0, checked: true }],
    ['行が小数', { line: 1.5, checked: true }],
    ['行が文字列', { line: '2', checked: true }],
    ['状態が無い', { line: 2 }],
    ['壊れた JSON', '{'],
  ])('%s なら 400', async (_label, body) => {
    expect((await call(tasks.PATCH, 'PATCH', body)).status).toBe(400)
    expect(toggleTask).not.toHaveBeenCalled()
  })

  test('本体の 409 (行がずれた) をそのまま返す', async () => {
    vi.mocked(toggleTask).mockRejectedValue(new CommandError(409, '本文が変わっています'))

    const res = await call(tasks.PATCH, 'PATCH', { line: 2, checked: true })

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('本文が変わっています')
  })
})

describe('health', () => {
  test('記録を本体へ渡し、書いたノートを返す', async () => {
    const res = await call(health.POST, 'POST', { ...HEALTH, values: [120, 80] })

    expect(recordHealth).toHaveBeenCalledWith(ID, { ...HEALTH, values: [120, 80] })
    expect(await res.json()).toEqual(ITEM_ENVELOPE)
  })

  test.each([
    ['値が空', { ...HEALTH, values: [] }],
    ['値が多すぎる', { ...HEALTH, values: [1, 2, 3, 4] }],
    ['数でない値', { ...HEALTH, values: ['1'] }],
    ['無限大を JSON で送れない値 (null)', { ...HEALTH, values: [null] }],
    ['値が配列でない', { ...HEALTH, values: 1 }],
    ['項目名が文字列でない', { ...HEALTH, item: 1 }],
    ['日付が長すぎる', { ...HEALTH, date: 'x'.repeat(101) }],
    ['単位が無い', { date: HEALTH.date, item: HEALTH.item, values: [1] }],
  ])('%s なら 400 で、書かない', async (_label, body) => {
    expect((await call(health.POST, 'POST', body)).status).toBe(400)
    expect(recordHealth).not.toHaveBeenCalled()
  })

  test('本体の 400 (記録できない値) をそのまま返す', async () => {
    vi.mocked(recordHealth).mockRejectedValue(new CommandError(400, 'この値は記録できません'))

    expect((await call(health.POST, 'POST', HEALTH)).status).toBe(400)
  })
})

describe('number', () => {
  test('番号を振ったノートを返す', async () => {
    const res = await call(number.POST, 'POST')

    expect(assignNoteNumber).toHaveBeenCalledWith(ID)
    expect(await res.json()).toEqual(ITEM_ENVELOPE)
  })

  test('空き番号が尽きた 409 をそのまま返す', async () => {
    vi.mocked(assignNoteNumber).mockRejectedValue(new CommandError(409, '空き番号がありません'))

    expect((await call(number.POST, 'POST')).status).toBe(409)
  })

  test('想定外の例外は 500 の定型文', async () => {
    vi.mocked(assignNoteNumber).mockRejectedValue(new Error('pg: deadlock detected'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await call(number.POST, 'POST')

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe(INTERNAL_ERROR_MESSAGE)
  })
})

describe('public', () => {
  test.each([true, false])('isPublic=%s を本体へ渡す', async (isPublic) => {
    const res = await call(publicRoute.PUT, 'PUT', { isPublic })

    expect(setNotePublic).toHaveBeenCalledWith(ID, isPublic)
    expect(await res.json()).toEqual(ITEM_ENVELOPE)
  })

  test.each([['1'], [1], [null]])('isPublic=%j は 400 (望む状態は真偽値だけ)', async (isPublic) => {
    expect((await call(publicRoute.PUT, 'PUT', { isPublic })).status).toBe(400)
    expect(setNotePublic).not.toHaveBeenCalled()
  })
})

describe('history', () => {
  test('commit はメッセージを本体へ渡し、履歴の画面を描き直させる', async () => {
    vi.mocked(commitNoteVersion).mockResolvedValue('noop')

    const res = await call(history.POST, 'POST', { op: 'commit', message: 'fix typo' })

    expect(commitNoteVersion).toHaveBeenCalledWith(ID, 'fix typo')
    expect((await res.json()).data).toEqual({ result: 'noop' })
    expect(mocks.revalidatePath.mock.calls).toEqual([[`/item/${ID}/history`]])
  })

  test('commit のメッセージが無ければ空で渡す (既定文言は本体が付ける)', async () => {
    await call(history.POST, 'POST', { op: 'commit' })

    expect(commitNoteVersion).toHaveBeenCalledWith(ID, '')
  })

  test('restore は書き戻したノートを返し、ノートと履歴の画面を描き直させる', async () => {
    const res = await call(history.POST, 'POST', { op: 'restore', oid: OID })

    expect(restoreNoteVersion).toHaveBeenCalledWith(ID, OID)
    expect(await res.json()).toEqual(ITEM_ENVELOPE)
    expect(mocks.revalidatePath.mock.calls).toEqual([[`/item/${ID}/history`], [`/item/${ID}`]])
  })

  test.each([
    ['op が無い', {}],
    ['op が知らない値', { op: 'reset' }],
    ['restore に oid が無い', { op: 'restore' }],
    ['メッセージが長すぎる', { op: 'commit', message: 'a'.repeat(MAX_TEXT_LENGTH + 1) }],
  ])('%s なら 400', async (_label, body) => {
    expect((await call(history.POST, 'POST', body)).status).toBe(400)
    expectNothingWritten()
  })

  test('restore の CommandError (履歴に無い版) をそのまま返す', async () => {
    vi.mocked(restoreNoteVersion).mockRejectedValue(
      new CommandError(404, 'このノートの履歴にないコミットです'),
    )

    const res = await call(history.POST, 'POST', { op: 'restore', oid: OID })

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('このノートの履歴にないコミットです')
  })
})
