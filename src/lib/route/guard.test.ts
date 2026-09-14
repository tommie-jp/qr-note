import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// guard.ts は currentUser 経由で sessionStore → db を読み込む。db.ts は
// モジュール読み込み時に DATABASE_URL を要求して投げるため、ログインの判定材料
// (currentUser) だけを差し替えて連鎖を断つ (export/route.test.ts と同じ流儀)。
// 呼ばれた回数も見る — デモで断る口はセッションを引く前に止まること
const mocks = vi.hoisted(() => ({
  user: 'tommie' as string | null,
  lookups: 0,
}))

vi.mock('@/lib/auth/session', () => ({
  currentUser: async () => {
    mocks.lookups += 1
    return mocks.user
  },
}))

import { denyIfDemoMode, guardRequest } from './guard'

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
  mocks.user = 'tommie'
  mocks.lookups = 0
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
