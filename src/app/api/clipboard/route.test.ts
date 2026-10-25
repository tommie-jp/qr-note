import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// サーバ経由のクリップボードの文字の口 (docs/114-サーバクリップボード計画.md §2)。
// 写真の撮影情報の口 (api/settings/photo-meta/route.test.ts) と同じ流儀:
// next/headers とセッションの DB を差し替え、門番の判定そのものは本物を通す。
// 保存は偽物
const META = { kind: 'text', bytes: 3, updatedAt: '2026-10-25T12:00:00.000Z', text: 'abc' }

const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  meta: null as unknown,
  written: [] as Array<{ user: string; text: string }>,
  cleared: [] as string[],
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

vi.mock('@/lib/clipboard/slotStore', () => ({
  readSlotMeta: async () => mocks.meta,
  writeSlotText: async (user: string, text: string) => {
    mocks.written.push({ user, text })
    return { ...META, text }
  },
  clearSlot: async (user: string) => {
    mocks.cleared.push(user)
  },
}))

const { GET, PUT, DELETE } = await import('./route')

function putRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/clipboard', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const plain = (method: string, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/clipboard', { method, headers })

const BAD_REQUEST = failEnvelope('リクエストの形式が正しくありません')

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.meta = null
  mocks.written = []
  mocks.cleared = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('拒否系 (読み書きする前に弾く)', () => {
  // デモは共有アカウントなので、1 枠が全員に見えてしまう
  test.each([
    ['GET', () => GET(plain('GET'))],
    ['PUT', () => PUT(putRequest({ text: 'a' }))],
    ['DELETE', () => DELETE(plain('DELETE'))],
  ])('%s: デモは未ログインでも 403', async (_name, call) => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    expect(await responseContract(await call())).toEqual(
      jsonContract(403, failEnvelope('デモモードでは利用できません')),
    )
    expect(mocks.written).toEqual([])
  })

  test.each([
    ['GET', () => GET(plain('GET'))],
    ['PUT', () => PUT(putRequest({ text: 'a' }))],
    ['DELETE', () => DELETE(plain('DELETE'))],
  ])('%s: 未ログインは 401', async (_name, call) => {
    mocks.sessionToken = null

    expect(await responseContract(await call())).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
  })

  test.each([
    ['GET', () => GET(plain('GET', { 'sec-fetch-site': 'cross-site' }))],
    ['PUT', () => PUT(putRequest({ text: 'a' }, { 'sec-fetch-site': 'cross-site' }))],
    ['DELETE', () => DELETE(plain('DELETE', { 'sec-fetch-site': 'cross-site' }))],
  ])('%s: クロスサイトは 403', async (_name, call) => {
    expect(await responseContract(await call())).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.written).toEqual([])
    expect(mocks.cleared).toEqual([])
  })
})

describe('GET', () => {
  test('枠が無ければ slot: null', async () => {
    const res = await GET(plain('GET'))

    expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ slot: null })))
  })

  test('枠があればメタ (文字は本文つき) を返す', async () => {
    mocks.meta = META

    const res = await GET(plain('GET'))

    expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ slot: META })))
  })
})

describe('PUT', () => {
  test('セッションの利用者名で保存し、メタを返す', async () => {
    const res = await PUT(putRequest({ text: 'hello' }, { 'sec-fetch-site': 'same-origin' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ slot: { ...META, text: 'hello' } })),
    )
    expect(mocks.written).toEqual([{ user: 'tommie', text: 'hello' }])
  })

  // 前後の空白も中身のうち。トリムすると貼り付けたコードのインデントが変わる
  test('空白や改行はそのまま保存する', async () => {
    await PUT(putRequest({ text: '  a\n\tb  ' }))

    expect(mocks.written).toEqual([{ user: 'tommie', text: '  a\n\tb  ' }])
  })

  test.each([
    ['壊れた JSON', '{'],
    ['text が無い', {}],
    ['text が文字列でない', { text: 42 }],
    ['text が空', { text: '' }],
    ['配列', []],
  ])('形が違えば畳まず 400: %s', async (_name, body) => {
    const res = await PUT(putRequest(body))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
    expect(mocks.written).toEqual([])
  })

  test('64KB を超える文字は 413', async () => {
    const res = await PUT(putRequest({ text: 'a'.repeat(64 * 1024 + 1) }))

    expect(await responseContract(res)).toEqual(
      jsonContract(413, failEnvelope('文字が大きすぎます (最大 64KB)')),
    )
    expect(mocks.written).toEqual([])
  })

  // 全角は 1 字 3 バイト。字数でなくバイト数で見る
  test('上限はバイト数で見る (全角 21846 字 = 65538 バイトは超える)', async () => {
    const res = await PUT(putRequest({ text: 'あ'.repeat(21846) }))

    expect(res.status).toBe(413)
  })

  // PostgreSQL の text は NUL を受けず、保存で例外 (500) になる
  test('NUL を含む文字は 400', async () => {
    const res = await PUT(putRequest({ text: 'a\u0000b' }))

    expect(await responseContract(res)).toEqual(jsonContract(400, BAD_REQUEST))
    expect(mocks.written).toEqual([])
  })

  // Content-Length を申告しない送信は事前検査を素通りする。読みながら数えて断る
  test('申告なしの巨大な本文は読み切らずに 413', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(64 * 1024))
      },
    })
    const request = new Request('http://localhost/api/clipboard', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit)

    const res = await PUT(request)

    expect(res.status).toBe(413)
    expect(mocks.written).toEqual([])
    // 上限 (約 384KB) を超えたところで止まる。無限には読まない
    expect(pulled).toBeLessThan(20)
  })

  // 制御文字は JSON で 6 倍に膨らむ。字数としては 64KB 以内の正当な文字を 413 にしない
  test('JSON で膨らむ制御文字だけの 64KB は通る', async () => {
    const res = await PUT(putRequest({ text: '\u0001'.repeat(64 * 1024) }))

    expect(res.status).toBe(200)
  })

  test('ちょうど 64KB は通る', async () => {
    const res = await PUT(putRequest({ text: 'a'.repeat(64 * 1024) }))

    expect(res.status).toBe(200)
  })
})

describe('DELETE', () => {
  test('枠を消して slot: null を返す', async () => {
    const res = await DELETE(plain('DELETE'))

    expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ slot: null })))
    expect(mocks.cleared).toEqual(['tommie'])
  })
})
