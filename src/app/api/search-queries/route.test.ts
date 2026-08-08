import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// 検索履歴の口 (docs/59-検索候補計画.md §7)。
// logs/clear/route.test.ts と同じ流儀: next/headers とセッションだけを
// 差し替えて、認証の判定そのものは本物を通す。
//
// 保存層 (searchQueryStore) は「誰の名前で呼ばれたか」を見たいので、
// 呼び出しを記録する偽物に差し替える。DB は別途 searchQueryStore.test.ts。
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  userName: 'tommie',
  registerFull: false,
  calls: [] as Array<{ fn: string; user: string; arg: unknown }>,
}))

vi.mock('next/headers', async () => {
  const { SESSION_COOKIE_NAME } = await import('@/lib/sessionToken')
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

vi.mock('@/lib/sessionStore', () => ({
  findActiveSession: async (token: string) =>
    token === mocks.validToken
      ? { userName: mocks.userName, expiresAt: new Date('2099-01-01T00:00:00.000Z') }
      : null,
}))

vi.mock('@/lib/searchQueryStore', () => {
  const record = (fn: string, user: string, arg: unknown) => {
    mocks.calls.push({ fn, user, arg })
    return { saved: [], recent: [] }
  }
  return {
    listQueries: async (user: string) => record('listQueries', user, null),
    recordUse: async (user: string, q: string) => record('recordUse', user, q),
    registerSaved: async (user: string, q: string) =>
      mocks.registerFull ? null : record('registerSaved', user, q),
    unregisterSaved: async (user: string, q: string) => record('unregisterSaved', user, q),
    importSavedQueries: async (user: string, qs: readonly string[]) =>
      record('importSavedQueries', user, qs),
  }
})

const URL_BASE = 'http://localhost/api/search-queries'

function request(
  method: string,
  body?: unknown,
  { path = '', headers = {} }: { path?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request(`${URL_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function routes() {
  return import('./route')
}

async function savedRoutes() {
  return import('./saved/route')
}

const originalDemo = process.env.DEMO_MODE

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.userName = 'tommie'
  mocks.registerFull = false
  mocks.calls = []
  delete process.env.DEMO_MODE
})

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

describe('拒否系 (触る前に弾く)', () => {
  test('未ログインは 401 で、保存層まで届かない', async () => {
    // Arrange
    mocks.sessionToken = null
    const { GET } = await routes()

    // Act
    const res = await GET(request('GET'))

    // Assert
    expect(res.status).toBe(401)
    expect(mocks.calls).toEqual([])
  })

  test('クロスサイトからの記録は 403', async () => {
    // Basic 認証は Cookie を使わないので SameSite が効かない (apiAuth.ts)
    const { POST } = await routes()

    const res = await POST(
      request('POST', { query: '抵抗' }, { headers: { 'sec-fetch-site': 'cross-site' } }),
    )

    expect(res.status).toBe(403)
    expect(mocks.calls).toEqual([])
  })

  test('デモは断らずに空を返す (共有アカウントなので覚えない)', async () => {
    process.env.DEMO_MODE = '1'
    const { GET, POST } = await routes()

    const read = await GET(request('GET'))
    const write = await POST(request('POST', { query: '抵抗' }))

    expect(read.status).toBe(200)
    expect((await read.json()).data).toEqual({ saved: [], recent: [] })
    expect(write.status).toBe(200)
    expect(mocks.calls).toEqual([]) // 訪問者どうしで見せ合わない
  })
})

describe('スコープ (誰の履歴か)', () => {
  test('セッションの名前で保存層を呼ぶ', async () => {
    mocks.userName = 'someone-else'
    const { POST } = await routes()

    await POST(request('POST', { query: '抵抗' }))

    expect(mocks.calls).toEqual([{ fn: 'recordUse', user: 'someone-else', arg: '抵抗' }])
  })

  test('本文で名乗っても無視する (他人の履歴は触れない)', async () => {
    const { POST } = await routes()

    await POST(request('POST', { query: '抵抗', userName: 'someone-else' }))

    expect(mocks.calls[0].user).toBe('tommie')
  })
})

describe('入力の検算', () => {
  test('query が無ければ 400', async () => {
    const { POST } = await routes()

    expect((await POST(request('POST', {}))).status).toBe(400)
    expect(mocks.calls).toEqual([])
  })

  test('query が文字列でなければ 400', async () => {
    const { POST } = await routes()

    expect((await POST(request('POST', { query: ['抵抗'] }))).status).toBe(400)
  })

  test('空白だけのクエリは 400 (覚える意味が無い)', async () => {
    const { POST } = await routes()

    expect((await POST(request('POST', { query: '   ' }))).status).toBe(400)
  })

  test('貼り付けた長文は溜め込まず 400', async () => {
    const { POST } = await routes()

    expect((await POST(request('POST', { query: 'あ'.repeat(500) }))).status).toBe(400)
  })

  test('壊れた JSON は 400', async () => {
    const { POST } = await routes()
    const broken = new Request(URL_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })

    expect((await POST(broken)).status).toBe(400)
  })
})

describe('引き取り (PUT /api/search-queries)', () => {
  test('登録パターンだけを渡し、覚えられない物は落とす', async () => {
    const { PUT } = await routes()

    await PUT(request('PUT', { saved: ['a', '', 7, 'b'] }))

    expect(mocks.calls).toEqual([
      { fn: 'importSavedQueries', user: 'tommie', arg: ['a', 'b'] },
    ])
  })

  test('空でも 200 (これが返らないと localStorage を消せない)', async () => {
    const { PUT } = await routes()

    expect((await PUT(request('PUT', { saved: [] }))).status).toBe(200)
  })
})

describe('登録パターン (/api/search-queries/saved)', () => {
  test('PUT で登録する', async () => {
    const { PUT } = await savedRoutes()

    const res = await PUT(request('PUT', { query: 'is:todo' }, { path: '/saved' }))

    expect(res.status).toBe(200)
    expect(mocks.calls).toEqual([{ fn: 'registerSaved', user: 'tommie', arg: 'is:todo' }])
  })

  test('満杯なら 409 (黙って捨てない)', async () => {
    mocks.registerFull = true
    const { PUT } = await savedRoutes()

    const res = await PUT(request('PUT', { query: 'one-too-many' }, { path: '/saved' }))

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('10')
  })

  test('DELETE で外す', async () => {
    const { DELETE } = await savedRoutes()

    const res = await DELETE(request('DELETE', { query: 'is:todo' }, { path: '/saved' }))

    expect(res.status).toBe(200)
    expect(mocks.calls).toEqual([{ fn: 'unregisterSaved', user: 'tommie', arg: 'is:todo' }])
  })

  test('未ログインは 401', async () => {
    mocks.sessionToken = null
    const { DELETE } = await savedRoutes()

    expect(
      (await DELETE(request('DELETE', { query: 'is:todo' }, { path: '/saved' }))).status,
    ).toBe(401)
  })
})
