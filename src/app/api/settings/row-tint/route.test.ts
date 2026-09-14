import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// 選択行の色を保存する口 (docs/88-選択行の色計画.md)。
// 他の route テストと同じ流儀: next/headers とセッションの DB を差し替え、
// 門番の判定そのものは本物を通す。保存 (rowTintStore) は偽物
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  saved: [] as Array<{ user: string; tint: string }>,
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

vi.mock('@/lib/rowTintStore', () => ({
  saveRowTintId: async (user: string, tint: string) => {
    mocks.saved.push({ user, tint })
  },
}))

const { PUT } = await import('./route')

function tintRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/settings/row-tint', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const BAD_REQUEST = failEnvelope('リクエストの形式が正しくありません')

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.saved = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('拒否系 (保存する前に弾く)', () => {
  // 共有アカウントでは 1 人が変えると全員の一覧の色が変わる
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await PUT(tintRequest({ tint: 'green' }, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
    expect(mocks.saved).toEqual([])
  })

  test('未ログインはクロスサイト判定より先に 401', async () => {
    mocks.sessionToken = null

    const res = await PUT(tintRequest({ tint: 'green' }, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
  })

  test('クロスサイトは 403', async () => {
    const res = await PUT(tintRequest({ tint: 'green' }, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
  })

  test('壊れた JSON は 400', async () => {
    const res = await PUT(tintRequest('{'))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  // 既定へ畳むと、送り手は保存できたと思い込んだまま次の読み込みで青に戻る
  test('知らない色は畳まず 400', async () => {
    const res = await PUT(tintRequest({ tint: 'crimson' }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
    expect(mocks.saved).toEqual([])
  })
})

test('セッションの利用者名で保存し、色を返す', async () => {
  const res = await PUT(tintRequest({ tint: 'green' }, { 'sec-fetch-site': 'same-origin' }))

  expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ tint: 'green' })))
  expect(mocks.saved).toEqual([{ user: 'tommie', tint: 'green' }])
})
