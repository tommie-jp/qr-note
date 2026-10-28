import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// 表示モードを cookie に書く口 (docs/118 §10 案 B)。ペイン構成の口の写し。
// 選択色の口 (row-tint) と同じ流儀: next/headers とセッションの DB を差し替え、
// 門番の判定そのものは本物を通す。書いた cookie は mocks.written に残す
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  written: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
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
      set: (name: string, value: string, options: Record<string, unknown>) => {
        mocks.written.push({ name, value, options })
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

const { PUT } = await import('./route')

function viewRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/settings/view-mode', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const BAD_REQUEST = failEnvelope('リクエストの形式が正しくありません')

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.written = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('拒否系 (cookie を書く前に弾く)', () => {
  test('未ログインは 401', async () => {
    mocks.sessionToken = null

    const res = await PUT(viewRequest({ mode: 'card' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
    expect(mocks.written).toEqual([])
  })

  test('クロスサイトは 403', async () => {
    const res = await PUT(viewRequest({ mode: 'card' }, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.written).toEqual([])
  })

  test('壊れた JSON は 400', async () => {
    const res = await PUT(viewRequest('{'))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  // 既定 (小) へ畳むと、画面は押したモードなのに cookie だけ小になる
  test('知らない表示モードは畳まず 400', async () => {
    const res = await PUT(viewRequest({ mode: 'huge' }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
    expect(mocks.written).toEqual([])
  })
})

test('表示モードを cookie に書き、書いた値を返す', async () => {
  const res = await PUT(viewRequest({ mode: 'image' }, { 'sec-fetch-site': 'same-origin' }))

  expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ mode: 'image' })))
  expect(mocks.written).toEqual([
    {
      name: 'view',
      value: 'image',
      options: expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    },
  ])
})

// 値は端末の cookie に載るだけで、共有アカウントの誰にも効かない
test('デモでも書ける', async () => {
  vi.stubEnv('DEMO_MODE', '1')

  const res = await PUT(viewRequest({ mode: 'card' }))

  expect(res.status).toBe(200)
  expect(mocks.written.map(({ value }) => value)).toEqual(['card'])
})
