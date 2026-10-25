import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mp4WithHandlers, webmFile } from '@/lib/uploads/sniff/__fixtures__/media'
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
const PDF = new TextEncoder().encode('%PDF-1.7\n%EOF')

const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  image: null as { mime: string; data: Uint8Array; name: string | null } | null,
  written: [] as Array<{ user: string; mime: string; bytes: number; name?: string }>,
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
  readSlotMedia: async () => mocks.image,
  writeSlotMedia: async (user: string, mime: string, data: Uint8Array, name: string | null) => {
    mocks.written.push({ user, mime, bytes: data.byteLength, ...(name ? { name } : {}) })
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
      jsonContract(404, failEnvelope('サーバのクリップボードにファイルがありません')),
    )
  })

  test('画像があれば生バイトを no-store で返す', async () => {
    mocks.image = { mime: 'image/png', data: PNG, name: null }

    const res = await GET(getRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('no-store')
    // 保存した画像が HTML として解釈されないようにする (配信の定石)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    // 直接開かれたときにスクリプトが走る余地を残さない
    expect(res.headers.get('content-security-policy')).toBe('sandbox')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
  })
})

describe('GET: ダウンロード専用のファイル', () => {
  test('octet-stream は attachment で配る (名前は RFC 5987)', async () => {
    mocks.image = { mime: 'application/octet-stream', data: new Uint8Array([1]), name: "成績 (1)'.zip" }

    const res = await GET(getRequest())

    expect(res.headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''%E6%88%90%E7%B8%BE%20%281%29%27.zip",
    )
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('名前が無ければ名前なしの attachment', async () => {
    mocks.image = { mime: 'application/octet-stream', data: new Uint8Array([1]), name: null }

    const res = await GET(getRequest())

    expect(res.headers.get('content-disposition')).toBe('attachment')
  })

  test('Office も attachment', async () => {
    mocks.image = {
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: new Uint8Array([1]),
      name: 'a.docx',
    }

    const res = await GET(getRequest())

    expect(res.headers.get('content-disposition')).toContain('attachment')
  })

  // 画像は <img> や貼り付けの取得で使うので attachment にしない
  test('画像には付けない', async () => {
    mocks.image = { mime: 'image/png', data: PNG, name: null }

    const res = await GET(getRequest())

    expect(res.headers.get('content-disposition')).toBeNull()
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

  test.each([
    ['PDF', PDF, 'application/pdf'],
    ['mp4 動画', mp4WithHandlers('isom', ['vide', 'soun']), 'video/mp4'],
    ['iPhone の mov 動画', mp4WithHandlers('qt  ', ['vide', 'soun']), 'video/quicktime'],
    ['webm 動画', webmFile(['V_VP9', 'A_OPUS']), 'video/webm'],
    ['m4a 音声', mp4WithHandlers('M4A ', ['soun']), 'audio/mp4'],
  ])('%s も受ける', async (_name, bytes, mime) => {
    const res = await PUT(putRequest(bytes))

    expect(res.status).toBe(200)
    expect(mocks.written).toEqual([{ user: 'tommie', mime, bytes: bytes.byteLength }])
  })

  // テキストには署名が無く、名前でしか区別できない
  test.each([
    ['memo.txt', 'text/plain; charset=utf-8'],
    ['データ.csv', 'text/csv; charset=utf-8'],
    ['note.md', 'text/markdown; charset=utf-8'],
  ])('テキスト %s は X-File-Name で判定する', async (name, mime) => {
    const bytes = new TextEncoder().encode('あ,い\n1,2\n')

    const res = await PUT(putRequest(bytes, { 'x-file-name': encodeURIComponent(name) }))

    expect(res.status).toBe(200)
    expect(mocks.written[0]?.mime).toBe(mime)
  })

  // 名前の無い文字は何のテキストか決められない。普通のファイルとして置く
  test('名前の無い文字は octet-stream の普通のファイル', async () => {
    const res = await PUT(putRequest(new TextEncoder().encode('hello')))

    expect(res.status).toBe(200)
    expect(mocks.written[0]?.mime).toBe('application/octet-stream')
  })

  test('壊れた X-File-Name は名前なし扱い (落ちない)', async () => {
    const res = await PUT(putRequest(new TextEncoder().encode('hello'), { 'x-file-name': '%E0%A4%A' }))

    expect(res.status).toBe(200)
    expect(mocks.written[0]).not.toHaveProperty('name')
  })

  // 写真は JPEG に揃える (HEIC・TIFF は受け取る側のアプリが読めないことがある)
  test('TIFF の写真は JPEG に変換して置く', async () => {
    const tiff = new Uint8Array(
      await sharp({ create: { width: 8, height: 6, channels: 3, background: '#3366cc' } })
        .tiff()
        .toBuffer(),
    )

    const res = await PUT(putRequest(tiff))

    expect(res.status).toBe(200)
    expect(mocks.written[0]?.mime).toBe('image/jpeg')
    expect(mocks.written[0]?.bytes).not.toBe(tiff.byteLength)
  })

  // ブラウザが読めない写真 (HEIC) は JPEG に変換する。壊れていれば復号に失敗して断る
  test('復号できない HEIC は 400 (置かない)', async () => {
    const res = await PUT(putRequest(HEIC))

    expect(res.status).toBe(400)
    expect(mocks.written).toEqual([])
  })

  test('壊れた TIFF は 400 (置かない)', async () => {
    const res = await PUT(putRequest(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0])))

    expect(res.status).toBe(400)
    expect(mocks.written).toEqual([])
  })

  // Office は名前と署名が合えば既知の mime で置き、元の名前も残す
  test('docx は Office の mime で、名前つきで置く', async () => {
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])

    const res = await PUT(putRequest(docx, { 'x-file-name': encodeURIComponent('議事録.docx') }))

    expect(res.status).toBe(200)
    expect(mocks.written).toEqual([
      {
        user: 'tommie',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: 8,
        name: '議事録.docx',
      },
    ])
  })

  // 知らない形式でも置く。mime は固定の octet-stream で、ブラウザは開かず保存だけにする
  test.each([
    ['HTML', new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'x.html'],
    ['SVG', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg'],
    ['zip', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), 'a.zip'],
    ['exe', new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), 'a.exe'],
  ])('%s も置ける (octet-stream に固定)', async (_name, bytes, fileName) => {
    const res = await PUT(putRequest(bytes, { 'x-file-name': fileName, 'content-type': 'text/html' }))

    expect(res.status).toBe(200)
    expect(mocks.written[0]).toMatchObject({ mime: 'application/octet-stream', name: fileName })
  })

  test('名前は整形して残す (パスや制御文字は信じない)', async () => {
    await PUT(
      putRequest(new Uint8Array([1, 2, 3]), {
        'x-file-name': encodeURIComponent('C:\\fakepath\\..\\a:b.bin'),
      }),
    )

    expect(mocks.written[0]?.name).toBe('a_b.bin')
  })

  test('空のファイルだけは断る', async () => {
    const res = await PUT(putRequest(new Uint8Array(0), { 'x-file-name': 'a.docx' }))

    expect(await responseContract(res)).toEqual(jsonContract(400, failEnvelope('ファイルが空です')))
    expect(mocks.written).toEqual([])
  })

  test('動画は 30MB まで通り、画像は 10MB で止まる', async () => {
    const mp4 = mp4WithHandlers('isom', ['vide'])
    const bigVideo = new Uint8Array(20 * 1024 * 1024)
    bigVideo.set(mp4)
    const bigImage = new Uint8Array(11 * 1024 * 1024)
    bigImage.set(PNG)

    const video = await PUT(putRequest(bigVideo))
    const image = await PUT(putRequest(bigImage))

    expect(video.status).toBe(200)
    expect(image.status).toBe(413)
    expect((await image.json()).error).toBe('ファイルが大きすぎます (最大 10MB)')
  })

  test('Content-Length が上限を超えていれば本文を読まず 413', async () => {
    const res = await PUT(putRequest(PNG, { 'content-length': String(32 * 1024 * 1024) }))

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
    expect(pulled).toBeLessThan(40)
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
