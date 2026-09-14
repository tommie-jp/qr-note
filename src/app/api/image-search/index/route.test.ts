import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { GET as GetFn } from './route'

// images.test.ts と同じ流儀: route を関数として直接呼ぶため next/headers を差し替える。
// ログイン検査 (bcrypt 照合) 自体は本物を通す (モックすると拒否系が緑のままになる)。
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
}))

// route を関数として直接呼ぶため、Next.js のリクエストスコープが無く
// cookies() が投げる。そこだけ差し替える。
//
// 認証はセッション Cookie で行う (docs/18-ログイン計画.md §11)。
// 判定そのもの (auth/requestAuth.ts) は本物を通し、DB を叩く findActiveSession
// だけを差し替える — 判定ごとモックすると、認証が壊れていても拒否系の
// テストが緑のままになる
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


beforeEach(() => {
  mocks.sessionToken = mocks.validToken
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// route は @/lib/db を import し、db.ts は読み込み時に DATABASE_URL を要求する。
// 拒否系 (401/403) は DB へ到達する前に return するので、未設定なら到達不能な
// ダミーを置く (images.test.ts と同じ。誤って DB に触れたら接続エラーで落ちる)。
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused'

async function importGet(): Promise<typeof GetFn> {
  const mod = await import('./route')
  return mod.GET
}

function getRequest(headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/image-search/index', { headers })
}

describe('拒否系 (DB に触れる前に弾く)', () => {
  test('未ログインは 401 を返す', async () => {
    mocks.sessionToken = null
    const GET = await importGet()

    const res = await GET(getRequest())

    expect(res.status).toBe(401)
  })

  test('クロスサイトからの呼び出しは 403 を返す', async () => {
    // GET は Origin を送らない <img> でも狙われるため Sec-Fetch-Site を見る
    // (auth/crossSite.ts)。ブラウザが第三者ページから出す要求は cross-site になる。
    const GET = await importGet()

    const res = await GET(getRequest({ 'sec-fetch-site': 'cross-site' }))

    expect(res.status).toBe(403)
  })
})
