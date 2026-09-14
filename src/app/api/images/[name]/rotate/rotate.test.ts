import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { POST as PostFn } from './route'

// route を関数として直接呼ぶため Next.js のリクエストスコープが無い。
// ログイン検査 (lib/auth/session.ts / sessionStore) が cookies() / DB を読むので、
// そこだけ差し替える。判定そのものは本物を通す (images.test.ts と同じ流儀)。
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

// route は @/lib/db → 読み込み時に DATABASE_URL を要求する。拒否系は DB に
// 到達する前に return するので、未設定のときだけ到達不能なダミーを置く
// (images.test.ts と同じ約束。誤って DB に触れたら接続エラーで落ちる)
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused'

// UUID.ext 形式の有効な保存名 (回転できる png / 回転できない gif)
const PNG_NAME = '0421547b-ee29-4613-a6d4-da0f41f94054.png'
const GIF_NAME = '11108562-47b2-4c00-846d-23dd7e804ff8.gif'

async function post(): Promise<typeof PostFn> {
  return (await import('./route')).POST
}

function rotateRequest(
  name: string,
  body: unknown,
  headers?: Record<string, string>,
): [Request, { params: Promise<{ name: string }> }] {
  return [
    new Request(`http://localhost/api/images/${name}/rotate`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    }),
    { params: Promise.resolve({ name }) },
  ]
}

beforeEach(() => {
  // 既定はログイン済み。拒否系が見たいのは「ログインの先の検査」なので、
  // ログインで落ちると何も検査できない
  mocks.sessionToken = mocks.validToken
})

describe('POST /api/images/[name]/rotate (DB に触れない拒否系)', () => {
  test('未ログインは 401', async () => {
    mocks.sessionToken = null
    const POST = await post()
    const res = await POST(...rotateRequest(PNG_NAME, { angle: 90 }))
    expect(res.status).toBe(401)
  })

  test('クロスサイトからの呼び出しは 403', async () => {
    const POST = await post()
    const res = await POST(
      ...rotateRequest(PNG_NAME, { angle: 90 }, { 'sec-fetch-site': 'cross-site' }),
    )
    expect(res.status).toBe(403)
  })

  test('不正なファイル名は 400', async () => {
    const POST = await post()
    const res = await POST(...rotateRequest('../../etc/passwd', { angle: 90 }))
    expect(res.status).toBe(400)
  })

  test('gif は回せないので 400', async () => {
    const POST = await post()
    const res = await POST(...rotateRequest(GIF_NAME, { angle: 90 }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('回転できません')
  })

  test('angle が 90/180/270 以外は 400', async () => {
    const POST = await post()
    for (const angle of [0, 45, 360, 'ninety', null]) {
      const res = await POST(...rotateRequest(PNG_NAME, { angle }))
      expect(res.status).toBe(400)
    }
  })

  test('body が JSON でなければ 400', async () => {
    const POST = await post()
    const [, ctx] = rotateRequest(PNG_NAME, { angle: 90 })
    const req = new Request(`http://localhost/api/images/${PNG_NAME}/rotate`, {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, ctx)
    expect(res.status).toBe(400)
  })
})
