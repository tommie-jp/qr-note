import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// guard.ts は currentUser 経由で sessionStore → db を読み込む。db.ts は
// モジュール読み込み時に DATABASE_URL を要求して投げるため、ログインの判定材料
// (currentUser) だけを差し替えて連鎖を断つ (export/route.test.ts と同じ流儀)。
// 呼ばれた回数も見る — デモで断る口はセッションを引く前に止まること
const mocks = vi.hoisted(() => ({
  user: 'tommie' as string | null,
  lookups: 0,
  // セッションの発行時刻 (再認証の門 guardRecentLogin が見る)
  createdAt: new Date() as Date,
}))

vi.mock('@/lib/auth/session', () => ({
  currentUser: async () => {
    mocks.lookups += 1
    return mocks.user
  },
  currentSession: async () =>
    mocks.user === null
      ? null
      : { userName: mocks.user, expiresAt: new Date('2099-01-01'), createdAt: mocks.createdAt },
}))

import { RECENT_LOGIN_MAX_AGE_MS } from '@/lib/auth/stepUp'
import { denyIfDemoMode, guardAdminRequest, guardRecentLogin, guardRequest } from './guard'

const originalDemo = process.env.DEMO_MODE

function request(site?: string): Request {
  return new Request('http://localhost/api/x', {
    headers: site === undefined ? {} : { 'sec-fetch-site': site },
  })
}

async function rejection(result: Awaited<ReturnType<typeof guardRequest>>) {
  if (result.ok) {
    throw new Error('通ってしまった')
  }
  return { status: result.response.status, body: await result.response.json() }
}

beforeEach(() => {
  delete process.env.DEMO_MODE
  delete process.env.ADMIN_USER
  mocks.user = 'tommie'
  mocks.lookups = 0
  mocks.createdAt = new Date()
})

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

// route handler 用の門番。デモインスタンスで閉じる口 (パスキー登録・ENEX
// インポート・ログ) が共有アカウントで叩かれても 403 に倒す (docs/38 §4)。
describe('denyIfDemoMode', () => {
  test('デモでないときは通す (null)', () => {
    expect(denyIfDemoMode()).toBeNull()
  })

  test('デモのときは 403 で断る', async () => {
    process.env.DEMO_MODE = '1'
    const denied = denyIfDemoMode()
    expect(denied?.status).toBe(403)
    const body = await denied?.json()
    expect(body).toMatchObject({ success: false, error: 'デモモードでは利用できません' })
  })

  // 旗の欠落に頼らない設計の裏返し — "1" 以外はデモ扱いにしない (isDemoMode と同じ)
  test('DEMO_MODE=1 以外の値では断らない', () => {
    for (const value of ['', 'true', '0']) {
      process.env.DEMO_MODE = value
      expect(denyIfDemoMode(), `DEMO_MODE=${JSON.stringify(value)}`).toBeNull()
    }
  })
})

describe('guardRequest', () => {
  test('ログイン済み・自分のページからなら利用者名で通す', async () => {
    const result = await guardRequest(request('same-origin'), { demo: 'deny' })

    expect(result).toEqual({ ok: true, user: 'tommie' })
  })

  test("demo: 'deny' はデモなら未ログインでもクロスサイトでも 403 で、セッションを引かない", async () => {
    process.env.DEMO_MODE = '1'
    mocks.user = null

    const result = await guardRequest(request('cross-site'), { demo: 'deny' })

    expect(await rejection(result)).toEqual({
      status: 403,
      body: { success: false, data: null, error: 'デモモードでは利用できません' },
    })
    expect(mocks.lookups).toBe(0)
  })

  test("demo: 'allow' はデモでも通す", async () => {
    process.env.DEMO_MODE = '1'

    expect(await guardRequest(request(), { demo: 'allow' })).toEqual({ ok: true, user: 'tommie' })
  })

  test('未ログインはクロスサイト判定より先に 401', async () => {
    mocks.user = null

    const result = await guardRequest(request('cross-site'), { demo: 'allow' })

    expect(await rejection(result)).toEqual({
      status: 401,
      body: { success: false, data: null, error: 'ログインが必要です' },
    })
  })

  test('クロスサイトは 403 (別のサブドメインも)', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const result = await guardRequest(request(site), { demo: 'allow' })

      expect(await rejection(result)).toEqual({
        status: 403,
        body: { success: false, data: null, error: 'クロスサイトからの呼び出しは許可されていません' },
      })
    }
  })

  // curl など Sec-Fetch-Site を送らない相手は通す (auth/crossSite.ts)
  test('Sec-Fetch-Site の無い呼び出しは通す', async () => {
    expect(await guardRequest(request(), { demo: 'deny' })).toEqual({ ok: true, user: 'tommie' })
  })
})

// 管理者だけの口 (2026-11 の監査 M-5)。guardRequest の 3 つの後に ADMIN_USER との一致を見る
describe('guardAdminRequest', () => {
  test('管理者なら通す', async () => {
    process.env.ADMIN_USER = 'tommie'
    const result = await guardAdminRequest(request('same-origin'), { demo: 'deny' })
    expect(result).toEqual({ ok: true, user: 'tommie' })
  })

  test('ログイン済みでも管理者でなければ 403', async () => {
    process.env.ADMIN_USER = 'someone-else'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await rejection(await guardAdminRequest(request('same-origin'), { demo: 'deny' }))).toEqual({
      status: 403,
      body: { success: false, data: null, error: '管理者だけが使えます' },
    })
    warn.mockRestore()
  })

  // 設定漏れは「誰も管理者ではない」側へ倒す (auth/admin.ts)
  test('ADMIN_USER が無ければ誰も通さない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await guardAdminRequest(request('same-origin'), { demo: 'deny' })
    expect(result.ok).toBe(false)
    warn.mockRestore()
  })

  test('未ログインは管理者判定より前に 401', async () => {
    mocks.user = null
    expect((await rejection(await guardAdminRequest(request(), { demo: 'deny' }))).status).toBe(401)
  })
})

// 「ログインし直して 10 分以内」の門 (auth/stepUp.ts。2026-11 の監査 M-6)
describe('guardRecentLogin', () => {
  test('発行したばかりのセッションは通す', async () => {
    const result = await guardRecentLogin(request('same-origin'), { demo: 'deny' })
    expect(result).toEqual({ ok: true, user: 'tommie' })
  })

  test('古いセッションは 403 で、ログインし直す文言を返す', async () => {
    mocks.createdAt = new Date(Date.now() - RECENT_LOGIN_MAX_AGE_MS - 1000)
    const { status, body } = await rejection(
      await guardRecentLogin(request('same-origin'), { demo: 'deny' }),
    )
    expect(status).toBe(403)
    expect(body.error).toContain('ログインし直')
  })

  test('未ログインは 401 のまま (再認証の文言にしない)', async () => {
    mocks.user = null
    expect((await rejection(await guardRecentLogin(request(), { demo: 'deny' }))).status).toBe(401)
  })

  test('デモは発行時刻を見る前に 403 で断る', async () => {
    process.env.DEMO_MODE = '1'
    const { body } = await rejection(await guardRecentLogin(request('same-origin'), { demo: 'deny' }))
    expect(body.error).toContain('デモ')
  })
})
