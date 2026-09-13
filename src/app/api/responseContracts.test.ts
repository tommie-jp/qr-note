import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// 振る舞いのテストは各 route の隣にある。ここは**応答の形そのもの** (状態コード・
// Cache-Control・本文のバイト列) だけを、封筒を手書きしていた口についてまとめて
// 押さえる (docs/93-リファクタリング計画.md §3-3)。
//
// Cache-Control が付いていない (null) 応答も今の契約として固定する。付け忘れを
// 揃えるときは、ここの期待値を書き換えることで変更が diff に残る
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  lookupBook: vi.fn(),
  lookupProduct: vi.fn(),
  storeAttachment: vi.fn(),
  importZip: vi.fn(),
  buildImageSearchIndex: vi.fn(),
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
      ? { userName: 'tommie', expiresAt: new Date('2099-01-01T00:00:00.000Z') }
      : null,
}))

vi.mock('@/lib/bookLookup', () => ({
  lookupBook: (isbn: string) => mocks.lookupBook(isbn),
}))

vi.mock('@/lib/coverImage', () => ({
  saveCoverImage: async () => '/api/images/cover.jpg',
}))

vi.mock('@/lib/productLookup', () => ({
  lookupProduct: (jan: string) => mocks.lookupProduct(jan),
}))

vi.mock('@/lib/attachmentStore', () => ({
  storeAttachment: (bytes: Uint8Array, options: unknown) => mocks.storeAttachment(bytes, options),
}))

vi.mock('@/lib/zip/importZip', () => ({
  importZip: (source: unknown, options: unknown) => mocks.importZip(source, options),
}))

vi.mock('@/lib/imageSearchIndex', () => ({
  buildImageSearchIndex: () => mocks.buildImageSearchIndex(),
}))

vi.mock('@/lib/zip/exportZip', () => ({
  exportEntries: async function* () {},
}))

// route は @/lib/db を import し、db.ts は読み込み時に DATABASE_URL を要求する。
// ここで見る応答はどれも DB に触る前に返る (images.test.ts と同じ約束)
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused'

const ISBN = '9784873115658'
const JAN = '4901777018686'
const PNG_NAME = '0421547b-ee29-4613-a6d4-da0f41f94054.png'

const CROSS_SITE = failEnvelope('クロスサイトからの呼び出しは許可されていません')
const LOGIN_REQUIRED = failEnvelope('ログインが必要です')
const DEMO_DENIED = failEnvelope('デモモードでは利用できません')

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.lookupBook.mockReset().mockResolvedValue({ title: 'リーダブルコード', coverUrl: 'x' })
  mocks.lookupProduct.mockReset().mockResolvedValue({ name: '天然水' })
  mocks.storeAttachment.mockReset().mockResolvedValue({ ok: true, url: `/api/images/${PNG_NAME}` })
  mocks.importZip.mockReset().mockResolvedValue({ imported: [], skipped: [] })
  mocks.buildImageSearchIndex.mockReset().mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('門番の応答 (どの口でも同じ封筒と no-store)', () => {
  test('未ログイン・クロスサイト・デモ', async () => {
    const { GET: images } = await import('./image-search/index/route')
    const { POST: clear } = await import('./logs/clear/route')

    mocks.sessionToken = null
    expect(await responseContract(await images(new Request('http://localhost/x')))).toEqual(
      jsonContract(401, LOGIN_REQUIRED),
    )

    mocks.sessionToken = mocks.validToken
    const crossSite = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(await responseContract(await clear(crossSite))).toEqual(jsonContract(403, CROSS_SITE))

    vi.stubEnv('DEMO_MODE', '1')
    expect(
      await responseContract(await clear(new Request('http://localhost/x', { method: 'POST' }))),
    ).toEqual(jsonContract(403, DEMO_DENIED))
  })
})

describe('/api/books/[isbn] (Cache-Control なし)', () => {
  const call = async (isbn: string) => {
    const { GET } = await import('./books/[isbn]/route')
    return GET(new Request(`http://localhost/api/books/${isbn}`), {
      params: Promise.resolve({ isbn }),
    })
  }

  test('ISBN でなければ 400', async () => {
    expect(await responseContract(await call(JAN))).toEqual(
      jsonContract(400, failEnvelope('ISBN ではありません'), null),
    )
  })

  test('書誌を返す (中継用の coverUrl は落とし、保存後の書影 URL を付ける)', async () => {
    expect(await responseContract(await call(ISBN))).toEqual(
      jsonContract(
        200,
        okEnvelope({ title: 'リーダブルコード', coverImageUrl: '/api/images/cover.jpg' }),
        null,
      ),
    )
  })

  test('見つからなければ data: null', async () => {
    mocks.lookupBook.mockResolvedValue(null)

    expect(await responseContract(await call(ISBN))).toEqual(jsonContract(200, okEnvelope(null), null))
  })

  test('想定外の失敗は 502', async () => {
    mocks.lookupBook.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await responseContract(await call(ISBN))).toEqual(
      jsonContract(502, failEnvelope('書誌の取得に失敗しました'), null),
    )
  })
})

describe('/api/products/[jan] (Cache-Control なし)', () => {
  const call = async (jan: string) => {
    const { GET } = await import('./products/[jan]/route')
    return GET(new Request(`http://localhost/api/products/${jan}`), {
      params: Promise.resolve({ jan }),
    })
  }

  // MemoEditor (usePrefill) が demoDisabled を見て文言を出す。HTTP は 200 のまま
  test('デモでは demoDisabled 付きの失敗を 200 で返す', async () => {
    vi.stubEnv('DEMO_MODE', '1')

    expect(await responseContract(await call(JAN))).toEqual(
      jsonContract(
        200,
        { ...failEnvelope('デモ版では JAN 情報を取得できません'), demoDisabled: true },
        null,
      ),
    )
    expect(mocks.lookupProduct).not.toHaveBeenCalled()
  })

  test('JAN でなければ 400', async () => {
    expect(await responseContract(await call('123'))).toEqual(
      jsonContract(400, failEnvelope('JAN ではありません'), null),
    )
  })

  test('商品情報を返す', async () => {
    expect(await responseContract(await call(JAN))).toEqual(
      jsonContract(200, okEnvelope({ name: '天然水' }), null),
    )
  })

  test('想定外の失敗は 502', async () => {
    mocks.lookupProduct.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await responseContract(await call(JAN))).toEqual(
      jsonContract(502, failEnvelope('商品情報の取得に失敗しました'), null),
    )
  })
})

describe('/api/export の失敗 (Cache-Control なし)', () => {
  const call = async (body: string, contentType = 'application/x-www-form-urlencoded') => {
    const { POST } = await import('./export/route')
    return POST(
      new Request('http://localhost/api/export', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body,
      }),
    )
  }

  test('フォームとして読めなければ 400', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await responseContract(await call('x', 'multipart/form-data; boundary=zz'))).toEqual(
      jsonContract(400, failEnvelope('フォームの形式が正しくありません'), null),
    )
  })

  test('scope が無ければ 400', async () => {
    expect(await responseContract(await call('itemNo=1'))).toEqual(
      jsonContract(400, failEnvelope('scope には all か selected を指定して下さい'), null),
    )
  })

  test('選択が空なら 400', async () => {
    expect(await responseContract(await call('scope=selected'))).toEqual(
      jsonContract(400, failEnvelope('ノートが選択されていません'), null),
    )
  })

  test('成功はファイルとして返す (no-store と nosniff)', async () => {
    const res = await call('scope=all')

    const headers = Object.fromEntries(res.headers)
    expect(headers['content-disposition']).toMatch(
      /^attachment; filename="qr-note-export-\d{4}-\d{2}-\d{2}\.zip"$/,
    )
    expect({ ...headers, 'content-disposition': undefined }).toEqual({
      'cache-control': 'no-store',
      'content-disposition': undefined,
      'content-type': 'application/zip',
      'x-content-type-options': 'nosniff',
    })
  })
})

describe('/api/import (Cache-Control なし)', () => {
  const call = async (query: string, body: BodyInit | null = 'x') => {
    const { POST } = await import('./import/route')
    return POST(new Request(`http://localhost/api/import${query}`, { method: 'POST', body }))
  }

  test('本文が無ければ 400', async () => {
    expect(await responseContract(await call('', null))).toEqual(
      jsonContract(400, failEnvelope('ファイルの中身が送られていません'), null),
    )
  })

  test('廃止した overwrite は 400', async () => {
    expect(await responseContract(await call('?overwrite=1'))).toEqual(
      jsonContract(400, failEnvelope('overwrite は廃止しました。conflict=overwrite を使って下さい'), null),
    )
  })

  test('知らない conflict は 400', async () => {
    expect(await responseContract(await call('?conflict=merge'))).toEqual(
      jsonContract(
        400,
        failEnvelope('conflict には skip / overwrite / renumber のいずれかを指定して下さい'),
        null,
      ),
    )
  })

  test('取り込めたら形式とレポートを返す', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])

    expect(await responseContract(await call('', zip))).toEqual(
      jsonContract(200, okEnvelope({ format: 'zip', imported: [], skipped: [] }), null),
    )
  })
})

describe('/api/images POST (Cache-Control なし)', () => {
  const call = async (form: FormData | null, headers: Record<string, string> = {}) => {
    const { POST } = await import('./images/route')
    return POST(
      new Request('http://localhost/api/images', {
        method: 'POST',
        headers,
        body: form ?? undefined,
      }),
    )
  }

  test('別オリジンは 403', async () => {
    expect(
      await responseContract(await call(new FormData(), { origin: 'https://evil.example' })),
    ).toEqual(jsonContract(403, failEnvelope('クロスオリジンのアップロードは許可されていません'), null))
  })

  test('file が無ければ 400', async () => {
    expect(await responseContract(await call(new FormData()))).toEqual(
      jsonContract(400, failEnvelope('file フィールドがありません'), null),
    )
  })

  test('保存を断られたら理由を 400 で返す', async () => {
    mocks.storeAttachment.mockResolvedValue({ ok: false, reason: '対応していない形式です' })
    const form = new FormData()
    form.set('file', new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }))

    expect(await responseContract(await call(form))).toEqual(
      jsonContract(400, failEnvelope('対応していない形式です'), null),
    )
  })

  test('保存できたら URL を返す', async () => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }))

    expect(await responseContract(await call(form))).toEqual(
      jsonContract(200, okEnvelope({ url: `/api/images/${PNG_NAME}` }), null),
    )
  })
})

describe('/api/images/[name] と rotate の検算 (Cache-Control なし)', () => {
  test('GET: 不正なファイル名は 400', async () => {
    const { GET } = await import('./images/[name]/route')
    const res = await GET(new Request('http://localhost/api/images/x'), {
      params: Promise.resolve({ name: '..%2Fetc' }),
    })

    expect(await responseContract(res)).toEqual(
      jsonContract(400, failEnvelope('不正なファイル名です'), null),
    )
  })

  const rotate = async (name: string, body: string) => {
    const { POST } = await import('./images/[name]/rotate/route')
    return POST(
      new Request(`http://localhost/api/images/${name}/rotate`, { method: 'POST', body }),
      { params: Promise.resolve({ name }) },
    )
  }

  test('rotate: 不正なファイル名は 400', async () => {
    expect(await responseContract(await rotate('x.png', '{}'))).toEqual(
      jsonContract(400, failEnvelope('不正なファイル名です'), null),
    )
  })

  test('rotate: JSON でなければ 400', async () => {
    expect(await responseContract(await rotate(PNG_NAME, '{'))).toEqual(
      jsonContract(400, failEnvelope('JSON の body を送信して下さい'), null),
    )
  })

  test('rotate: 角度が違えば 400', async () => {
    expect(await responseContract(await rotate(PNG_NAME, '{"angle":45}'))).toEqual(
      jsonContract(400, failEnvelope('angle は 90 / 180 / 270 のいずれかです'), null),
    )
  })
})

describe('no-store を付けている成功応答', () => {
  test('/api/client-logs: 受け取りは data: null、形式違いは 400', async () => {
    const { POST } = await import('./client-logs/route')
    const post = (body: string) =>
      POST(new Request('http://localhost/api/client-logs', { method: 'POST', body }))

    expect(await responseContract(await post('{'))).toEqual(
      jsonContract(400, failEnvelope('ログの形式が不正です')),
    )
    expect(await responseContract(await post('{"items":[]}'))).toEqual(
      jsonContract(400, failEnvelope('ログの形式が不正です')),
    )
    expect(
      await responseContract(await post('{"items":[{"level":"warn","text":"x"}]}')),
    ).toEqual(jsonContract(200, okEnvelope(null)))
  })

  test('/api/image-search/index: entries を包んで返す', async () => {
    mocks.buildImageSearchIndex.mockResolvedValue([{ itemNo: '1' }])
    const { GET } = await import('./image-search/index/route')

    expect(await responseContract(await GET(new Request('http://localhost/x')))).toEqual(
      jsonContract(200, okEnvelope({ entries: [{ itemNo: '1' }] })),
    )
  })

  test('/api/import/progress: 取り込み中でなければ data: null', async () => {
    const { GET } = await import('./import/progress/route')

    expect(await responseContract(await GET(new Request('http://localhost/x')))).toEqual(
      jsonContract(200, okEnvelope(null)),
    )
  })

  test('/api/logs/clear: data: null', async () => {
    const { POST } = await import('./logs/clear/route')

    expect(
      await responseContract(await POST(new Request('http://localhost/x', { method: 'POST' }))),
    ).toEqual(jsonContract(200, okEnvelope(null)))
  })
})
