import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { failEnvelope, jsonContract, okEnvelope, responseContract } from '@/test/routeResponse'

// サーバ経由のクリップボードの見本の絵の口 (docs/115 §2)。
// 門番は本物、保存は偽物 (../data/route.test.ts と同じ流儀)。作り直し (makeThumbnail) は本物
const VERSION = '2026-10-26T06:00:00.000Z'
const META = {
  kind: 'video',
  bytes: 10,
  updatedAt: VERSION,
  mime: 'video/mp4',
  hasThumb: true,
}

const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  thumb: null as Uint8Array | null,
  attached: [] as Array<{ user: string; version: string; format: string | undefined }>,
  attachStatus: 'ok' as 'ok' | 'stale' | 'missing',
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
  readSlotThumb: async () => mocks.thumb,
  attachSlotThumb: async (user: string, version: Date, thumb: Uint8Array) => {
    const { format } = await (await import('sharp')).default(thumb).metadata()
    mocks.attached.push({ user, version: version.toISOString(), format })
    return mocks.attachStatus === 'ok' ? { status: 'ok', meta: META } : { status: mocks.attachStatus }
  },
}))

const { GET, PUT } = await import('./route')

const pngOf = async (width = 64, height = 48) =>
  new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: '#33aa66' } }).png().toBuffer(),
  )

function putRequest(body: Uint8Array, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/clipboard/thumb', {
    method: 'PUT',
    headers: { 'content-type': 'image/png', 'x-slot-version': VERSION, ...headers },
    body: body as BodyInit,
  })
}

const getRequest = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/clipboard/thumb', { headers })

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.thumb = null
  mocks.attached = []
  mocks.attachStatus = 'ok'
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('門番', () => {
  test('デモは未ログインでも 403', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    mocks.sessionToken = null

    for (const res of [await GET(getRequest()), await PUT(putRequest(await pngOf()))]) {
      expect(await responseContract(res)).toEqual(
        jsonContract(403, failEnvelope('デモモードでは利用できません')),
      )
    }
    expect(mocks.attached).toEqual([])
  })

  test('未ログインは 401、クロスサイトは 403', async () => {
    mocks.sessionToken = null
    expect((await GET(getRequest())).status).toBe(401)

    mocks.sessionToken = mocks.validToken
    const cross = { 'sec-fetch-site': 'cross-site' }
    expect((await GET(getRequest(cross))).status).toBe(403)
    expect((await PUT(putRequest(await pngOf(), cross))).status).toBe(403)
    expect(mocks.attached).toEqual([])
  })
})

describe('GET', () => {
  test('見本が無ければ 404', async () => {
    expect(await responseContract(await GET(getRequest()))).toEqual(
      jsonContract(404, failEnvelope('サーバのクリップボードに見本がありません')),
    )
  })

  test('見本は WebP で、持たせず、開かれても動かない', async () => {
    mocks.thumb = new Uint8Array([1, 2, 3])

    const res = await GET(getRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBe('sandbox')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('PUT', () => {
  // クライアントのバイト列はそのまま置かない。必ず作り直す
  test('受けた絵を WebP に作り直し、版つきで貼る', async () => {
    const res = await PUT(putRequest(await pngOf()))

    expect(await responseContract(res)).toEqual(jsonContract(200, okEnvelope({ slot: META })))
    expect(mocks.attached).toEqual([{ user: 'tommie', version: VERSION, format: 'webp' }])
  })

  test('版が無い・読めないときは 400', async () => {
    const png = await pngOf()

    expect((await PUT(putRequest(png, { 'x-slot-version': 'x' }))).status).toBe(400)
    const noVersion = new Request('http://localhost/api/clipboard/thumb', {
      method: 'PUT',
      body: png as BodyInit,
    })
    expect((await PUT(noVersion)).status).toBe(400)
    expect(mocks.attached).toEqual([])
  })

  test.each([
    ['SVG', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['画像でない', new Uint8Array([1, 2, 3, 4])],
    ['空', new Uint8Array(0)],
  ])('%s は 400 (貼らない)', async (_name, bytes) => {
    const res = await PUT(putRequest(bytes))

    expect(await responseContract(res)).toEqual(
      jsonContract(400, failEnvelope('見本の絵として読めません')),
    )
    expect(mocks.attached).toEqual([])
  })

  test('200KB を超える絵は 413 (申告でも、申告なしでも)', async () => {
    const big = new Uint8Array(200 * 1024 + 1)
    big.set(await pngOf())

    expect((await PUT(putRequest(big))).status).toBe(413)

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
      },
    })
    const chunked = new Request('http://localhost/api/clipboard/thumb', {
      method: 'PUT',
      headers: { 'x-slot-version': VERSION },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect((await PUT(chunked)).status).toBe(413)
    expect(mocks.attached).toEqual([])
  })

  test('別の端末が置き直していれば 409', async () => {
    mocks.attachStatus = 'stale'

    expect(await responseContract(await PUT(putRequest(await pngOf())))).toEqual(
      jsonContract(409, failEnvelope('サーバのクリップボードが置き直されました')),
    )
  })

  test('枠が無ければ 404', async () => {
    mocks.attachStatus = 'missing'

    expect((await PUT(putRequest(await pngOf()))).status).toBe(404)
  })
})
