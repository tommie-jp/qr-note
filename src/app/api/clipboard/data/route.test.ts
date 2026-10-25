import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { failEnvelope, jsonContract, okEnvelope, responseContract } from '@/test/routeResponse'

// サーバ経由のクリップボードの画像の口 (docs/114-サーバクリップボード計画.md §2)。
// 文字の口 (../route.test.ts) と同じ流儀で、門番は本物・保存は偽物
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
])
const HEIC = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0,
])
const PDF = new TextEncoder().encode('%PDF-1.7')

const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  image: null as { mime: string; data: Uint8Array } | null,
  written: [] as Array<{ user: string; mime: string; bytes: number }>,
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
  readSlotImage: async () => mocks.image,
  writeSlotImage: async (user: string, mime: string, data: Uint8Array) => {
    mocks.written.push({ user, mime, bytes: data.byteLength })
    return { kind: 'image', bytes: data.byteLength, updatedAt: '2026-10-25T12:00:00.000Z' }
  },
}))

const { GET, PUT } = await import('./route')

function putRequest(body: Uint8Array, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/clipboard/data', {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', ...headers },
    body: body as BodyInit,
  })
}

const getRequest = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/clipboard/data', { headers })

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.image = null
  mocks.written = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('拒否系', () => {
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    for (const res of [await GET(getRequest()), await PUT(putRequest(PNG))]) {
      expect(await responseContract(res)).toEqual(
        jsonContract(403, failEnvelope('デモモードでは利用できません')),
      )
    }
    expect(mocks.written).toEqual([])
  })

  test('未ログインは 401', async () => {
    mocks.sessionToken = null

    for (const res of [await GET(getRequest()), await PUT(putRequest(PNG))]) {
      expect(res.status).toBe(401)
    }
  })

  test('クロスサイトは 403 (保存しない)', async () => {
    const headers = { 'sec-fetch-site': 'cross-site' }

    for (const res of [await GET(getRequest(headers)), await PUT(putRequest(PNG, headers))]) {
      expect(res.status).toBe(403)
    }
    expect(mocks.written).toEqual([])
  })

  // CSRF の Origin 検査 (uploads/request.ts)。Sec-Fetch-Site を送らない古い経路の備え
  test('Origin が違う PUT は 403', async () => {
    const res = await PUT(putRequest(PNG, { origin: 'https://evil.example', host: 'localhost' }))

    expect(res.status).toBe(403)
    expect(mocks.written).toEqual([])
  })
})

describe('GET', () => {
  test('画像が無ければ 404', async () => {
    const res = await GET(getRequest())

    expect(await responseContract(res)).toEqual(
      jsonContract(404, failEnvelope('サーバのクリップボードに画像がありません')),
    )
  })

  test('画像があれば生バイトを no-store で返す', async () => {
    mocks.image = { mime: 'image/png', data: PNG }

    const res = await GET(getRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('no-store')
    // 保存した画像が HTML として解釈されないようにする (配信の定石)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
  })
})

describe('PUT', () => {
  test.each([
    ['png', PNG, 'image/png'],
    ['jpeg', JPEG, 'image/jpeg'],
    ['gif', GIF, 'image/gif'],
    ['webp', WEBP, 'image/webp'],
  ])('%s は中身から mime を決めて保存する', async (_name, bytes, mime) => {
    // 申告は octet-stream。申告を信じず、中身の署名で決める
    const res = await PUT(putRequest(bytes))

    expect(await responseContract(res)).toEqual(
      jsonContract(
        200,
        okEnvelope({
          slot: { kind: 'image', bytes: bytes.byteLength, updatedAt: '2026-10-25T12:00:00.000Z' },
        }),
      ),
    )
    expect(mocks.written).toEqual([{ user: 'tommie', mime, bytes: bytes.byteLength }])
  })

  test('申告が image/png でも、中身が JPEG なら JPEG で保存する', async () => {
    await PUT(putRequest(JPEG, { 'content-type': 'image/png' }))

    expect(mocks.written[0]?.mime).toBe('image/jpeg')
  })

  // PDF や HEIC など、クリップボードに載せられない形式を置いても受け取れない
  test.each([
    ['PDF', PDF],
    ['HEIC', HEIC],
    ['空', new Uint8Array(0)],
  ])('画像でない・載せられない形式は 400: %s', async (_name, bytes) => {
    const res = await PUT(putRequest(bytes))

    expect(await responseContract(res)).toEqual(
      jsonContract(400, failEnvelope('クリップボードに載せられる画像ではありません')),
    )
    expect(mocks.written).toEqual([])
  })

  test('Content-Length が上限を超えていれば本文を読まず 413', async () => {
    const res = await PUT(putRequest(PNG, { 'content-length': String(12 * 1024 * 1024) }))

    expect(res.status).toBe(413)
    expect(mocks.written).toEqual([])
  })

  test('申告なしの巨大な本文は読み切らずに 413', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
    })
    const request = new Request('http://localhost/api/clipboard/data', {
      method: 'PUT',
      body: stream,
      duplex: 'half',
    } as RequestInit)

    const res = await PUT(request)

    expect(res.status).toBe(413)
    expect(mocks.written).toEqual([])
    expect(pulled).toBeLessThan(15)
  })

  // Content-Length を申告しない送信 (chunked) は事前検査を素通りする
  test('申告なしで本文が上限を超えても 413', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    big.set(PNG)

    const res = await PUT(putRequest(big))

    expect(res.status).toBe(413)
    expect(mocks.written).toEqual([])
  })
})
