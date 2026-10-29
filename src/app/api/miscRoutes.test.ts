import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { backfillHistory } from '@/lib/commands/historyCommands'
import { startBenchmark } from '@/lib/diag/benchmark'
import { startJob } from '@/lib/diag/benchJob'
import { loadBenchStatus, type BenchStatus } from '@/lib/diag/benchStatus'
import { countFolderTotals, listTags } from '@/lib/items/read'
import { countTrashedItems } from '@/lib/items/trash'
import { isPerfLogEnabled } from '@/lib/logging/perfSwitch'
import { listQueries } from '@/lib/search/queryStore'

// 小さな口をまとめて見る (docs/123 §1-3・§2-1):
//   GET  /api/tags              … タグの一覧
//   GET  /api/folders           … 検索フォルダーの中身
//   PUT  /api/settings/sort     … 並び順の cookie
//   POST /api/history/backfill  … 全ノートを履歴へ取り込む (デモで閉じる)
//   GET/POST /api/diag/bench    … ベンチマーク (デモで閉じる・管理者だけ)
// 門番は本物 (next/headers とセッションだけ差し替え)。DB・git・計測の層は偽物
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  userName: 'tommie',
  setCookie: vi.fn(),
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
      getAll: () =>
        mocks.sessionToken === null ? [] : [{ name: SESSION_COOKIE_NAME, value: mocks.sessionToken }],
      set: mocks.setCookie,
    }),
  }
})
vi.mock('@/lib/auth/sessionStore', () => ({
  findActiveSession: async (token: string) =>
    token === mocks.validToken
      ? { userName: mocks.userName, expiresAt: new Date('2099-01-01T00:00:00.000Z') }
      : null,
}))
vi.mock('@/lib/items/read', () => ({ listTags: vi.fn(), countFolderTotals: vi.fn() }))
vi.mock('@/lib/items/trash', () => ({ countTrashedItems: vi.fn() }))
vi.mock('@/lib/search/queryStore', () => ({ listQueries: vi.fn() }))
vi.mock('@/lib/commands/historyCommands', () => ({ backfillHistory: vi.fn() }))
vi.mock('@/lib/diag/benchmark', () => ({ startBenchmark: vi.fn() }))
vi.mock('@/lib/diag/benchJob', () => ({ startJob: vi.fn() }))
vi.mock('@/lib/diag/benchStatus', () => ({ loadBenchStatus: vi.fn() }))
vi.mock('@/lib/diag/serverBench', () => ({ pageBenchCookie: () => 'c=1', runServerBench: vi.fn() }))
vi.mock('@/lib/logging/perfSwitch', () => ({ isPerfLogEnabled: vi.fn() }))

const tags = await import('./tags/route')
const folders = await import('./folders/route')
const sort = await import('./settings/sort/route')
const backfill = await import('./history/backfill/route')
const bench = await import('./diag/bench/route')

const CROSS_SITE = { 'sec-fetch-site': 'cross-site' }
const STATUS: BenchStatus = {
  running: null,
  cpu: null,
  server: null,
  clients: [],
  profileAt: null,
  errors: [],
}

function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/x', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const originalEnv = { demo: process.env.DEMO_MODE, admin: process.env.ADMIN_USER }

function restoreEnv(name: 'DEMO_MODE' | 'ADMIN_USER', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sessionToken = mocks.validToken
  mocks.userName = 'tommie'
  delete process.env.DEMO_MODE
  process.env.ADMIN_USER = 'tommie'
  vi.mocked(listTags).mockResolvedValue([
    { tag: '抵抗', count: 5 },
    { tag: '1003', count: 1 },
    { tag: 'ひとつ', count: 1 },
  ])
  vi.mocked(countFolderTotals).mockResolvedValue({ total: 7, untagged: 2 })
  vi.mocked(countTrashedItems).mockResolvedValue(3)
  vi.mocked(listQueries).mockResolvedValue({ saved: ['is:todo'], recent: ['x'] })
  vi.mocked(loadBenchStatus).mockResolvedValue(STATUS)
  vi.mocked(isPerfLogEnabled).mockReturnValue(false)
})

afterEach(() => {
  restoreEnv('DEMO_MODE', originalEnv.demo)
  restoreEnv('ADMIN_USER', originalEnv.admin)
})

describe('GET /api/tags', () => {
  test('件数つきのタグを返す', async () => {
    // Act
    const res = await tags.GET(request('GET'))

    // Assert
    expect(await res.json()).toEqual({
      success: true,
      data: { tags: await listTags() },
      error: null,
    })
  })

  test('未ログインは 401、クロスサイトは 403', async () => {
    const crossSite = await tags.GET(request('GET', undefined, CROSS_SITE))
    mocks.sessionToken = null
    const loggedOut = await tags.GET(request('GET'))

    expect(crossSite.status).toBe(403)
    expect(loggedOut.status).toBe(401)
  })
})

describe('GET /api/folders', () => {
  test('タグの出し分けまで済ませ、件数と自分の登録パターンを添える', async () => {
    mocks.userName = 'someone'

    const res = await folders.GET(request('GET'))

    expect((await res.json()).data).toEqual({
      tags: [{ tag: '抵抗', count: 5 }],
      hiddenTags: 2,
      totals: { total: 7, untagged: 2 },
      trashCount: 3,
      saved: ['is:todo'],
    })
    expect(listQueries).toHaveBeenCalledWith('someone')
  })

  test('未ログインは 401 で DB を引かない、クロスサイトは 403', async () => {
    const crossSite = await folders.GET(request('GET', undefined, CROSS_SITE))
    mocks.sessionToken = null
    const loggedOut = await folders.GET(request('GET'))

    expect(crossSite.status).toBe(403)
    expect(loggedOut.status).toBe(401)
    expect(listQueries).not.toHaveBeenCalled()
  })
})

describe('PUT /api/settings/sort', () => {
  const COOKIE = { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 31_536_000 }

  test('一覧の並びを sort の cookie に書く', async () => {
    const res = await sort.PUT(request('PUT', { sort: 'title' }))

    expect((await res.json()).data).toEqual({ sort: 'title' })
    expect(mocks.setCookie.mock.calls).toStrictEqual([['sort', 'title', COOKIE]])
  })

  test('scope=trash はゴミ箱の並びを別の cookie に書く (削除順も選べる)', async () => {
    await sort.PUT(request('PUT', { sort: 'deleted', scope: 'trash' }))

    expect(mocks.setCookie.mock.calls).toStrictEqual([['trashSort', 'deleted', COOKIE]])
  })

  test.each([
    ['知らない並び', { sort: 'random' }],
    ['一覧に削除順は無い', { sort: 'deleted' }],
    ['ゴミ箱の知らない並び', { sort: 'random', scope: 'trash' }],
    ['壊れた JSON', '{'],
  ])('%s は 400 で、cookie を書かない', async (_label, body) => {
    expect((await sort.PUT(request('PUT', body))).status).toBe(400)
    expect(mocks.setCookie).not.toHaveBeenCalled()
  })

  test('未ログインは 401、クロスサイトは 403', async () => {
    const crossSite = await sort.PUT(request('PUT', { sort: 'title' }, CROSS_SITE))
    mocks.sessionToken = null
    const loggedOut = await sort.PUT(request('PUT', { sort: 'title' }))

    expect(crossSite.status).toBe(403)
    expect(loggedOut.status).toBe(401)
    expect(mocks.setCookie).not.toHaveBeenCalled()
  })
})

describe('POST /api/history/backfill', () => {
  test.each(['imported', 'noop'] as const)(
    '取り込みの結果 (%s) を返し、設定画面を描き直させる',
    async (result) => {
      vi.mocked(backfillHistory).mockResolvedValue(result)

      const res = await backfill.POST(request('POST'))

      expect(await res.json()).toEqual({ success: true, data: { result }, error: null })
      expect(mocks.revalidatePath.mock.calls).toEqual([['/settings/history']])
    },
  )

  test('デモでは、ログインより先に 403 で断る', async () => {
    process.env.DEMO_MODE = '1'
    mocks.sessionToken = null

    expect((await backfill.POST(request('POST'))).status).toBe(403)
    expect(backfillHistory).not.toHaveBeenCalled()
  })

  test('未ログインは 401、クロスサイトは 403', async () => {
    const crossSite = await backfill.POST(request('POST', undefined, CROSS_SITE))
    mocks.sessionToken = null
    const loggedOut = await backfill.POST(request('POST'))

    expect(crossSite.status).toBe(403)
    expect(loggedOut.status).toBe(401)
    expect(backfillHistory).not.toHaveBeenCalled()
  })

  test('取り込みの失敗は 500 の定型文で、描き直させない', async () => {
    vi.mocked(backfillHistory).mockRejectedValue(new Error('git: index.lock exists'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await backfill.POST(request('POST'))

    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('index.lock')
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe('/api/diag/bench', () => {
  test('GET は管理者に状態を返す', async () => {
    const res = await bench.GET(request('GET'))

    expect(await res.json()).toEqual({ success: true, data: STATUS, error: null })
  })

  test('管理者でなければ 403 で、状態も見せない', async () => {
    mocks.userName = 'guest'

    const res = await bench.GET(request('GET'))

    expect(res.status).toBe(403)
    expect(loadBenchStatus).not.toHaveBeenCalled()
  })

  test('ADMIN_USER が未設定なら誰も管理者ではない', async () => {
    delete process.env.ADMIN_USER

    expect((await bench.GET(request('GET'))).status).toBe(403)
  })

  test.each([
    ['GET', () => bench.GET(request('GET'))],
    ['POST', () => bench.POST(request('POST', { kind: 'cpu' }))],
  ])('%s はデモでは、ログインより先に 403 で断る', async (_method, run) => {
    process.env.DEMO_MODE = '1'
    mocks.sessionToken = null

    expect((await run()).status).toBe(403)
    expect(loadBenchStatus).not.toHaveBeenCalled()
  })

  test('未ログインは 401、クロスサイトは 403', async () => {
    const crossSite = await bench.POST(request('POST', { kind: 'cpu' }, CROSS_SITE))
    mocks.sessionToken = null
    const loggedOut = await bench.POST(request('POST', { kind: 'cpu' }))

    expect(crossSite.status).toBe(403)
    expect(loggedOut.status).toBe(401)
    expect(startBenchmark).not.toHaveBeenCalled()
  })

  test('POST cpu は CPU の計測を始めて状態を返す', async () => {
    const res = await bench.POST(request('POST', { kind: 'cpu' }))

    expect(res.status).toBe(200)
    expect(startBenchmark).toHaveBeenCalledWith(expect.any(Number))
    expect(startJob).not.toHaveBeenCalled()
  })

  test('POST server はサーバの計測を裏で始める', async () => {
    await bench.POST(request('POST', { kind: 'server' }))

    expect(startJob).toHaveBeenCalledWith('server', expect.any(Function))
    expect(startBenchmark).not.toHaveBeenCalled()
  })

  test.each([[{ kind: 'gpu' }], [{}], ['{']])('POST の本文 %j は 400', async (body) => {
    expect((await bench.POST(request('POST', body))).status).toBe(400)
    expect(startBenchmark).not.toHaveBeenCalled()
  })

  test('速度計測の最中は 409 で断る (CPU の取り合いを避ける)', async () => {
    vi.mocked(isPerfLogEnabled).mockReturnValue(true)

    const res = await bench.POST(request('POST', { kind: 'cpu' }))

    expect(res.status).toBe(409)
    expect(startBenchmark).not.toHaveBeenCalled()
  })
})
