import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// 写真の撮影情報を残すかを保存する口 (docs/97-写真の撮影情報削除計画.md §5)。
// 選択色の口 (api/settings/row-tint/route.test.ts) と同じ流儀: next/headers と
// セッションの DB を差し替え、門番の判定そのものは本物を通す。保存は偽物
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  saved: [] as Array<{ user: string; mode: string }>,
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

vi.mock('@/lib/prefs/photoMetaStore', () => ({
  savePhotoMetaMode: async (user: string, mode: string) => {
    mocks.saved.push({ user, mode })
  },
}))

const { PUT } = await import('./route')

function modeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/settings/photo-meta', {
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
  // 共有アカウントでは 1 人が「残す」にすると全員の写真に効く
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    const res = await PUT(modeRequest({ mode: 'keep' }, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
    expect(mocks.saved).toEqual([])
  })

  test('未ログインは 401', async () => {
    mocks.sessionToken = null

    const res = await PUT(modeRequest({ mode: 'keep' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
  })

  test('クロスサイトは 403', async () => {
    const res = await PUT(modeRequest({ mode: 'keep' }, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.saved).toEqual([])
  })

  test('壊れた JSON は 400', async () => {
    const res = await PUT(modeRequest('{'))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
  })

  // 既定へ畳むと、送り手は「残す」にできたと思い込んだまま消され続ける
  test('知らない値は畳まず 400', async () => {
    const res = await PUT(modeRequest({ mode: 'yes' }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
    expect(mocks.saved).toEqual([])
  })
})

test('セッションの利用者名で保存し、値を返す', async () => {
  for (const mode of ['keep', 'strip']) {
    const res = await PUT(modeRequest({ mode }, { 'sec-fetch-site': 'same-origin' }))

    expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ mode })))
  }
  expect(mocks.saved).toEqual([
    { user: 'tommie', mode: 'keep' },
    { user: 'tommie', mode: 'strip' },
  ])
})
