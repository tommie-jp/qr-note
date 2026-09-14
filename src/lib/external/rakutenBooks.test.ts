import { afterEach, expect, test, vi } from 'vitest'
import { fetchCoverUrl, parseRakutenCoverUrl, rakutenBooksUrl } from './rakutenBooks'

const IMAGE_URL =
  'https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/5658/9784873115658.jpg?_ex=200x200'

// formatVersion=2 の形 (Items がフラット)
const flat = (overrides: Record<string, unknown> = {}) => ({
  count: 1,
  hits: 1,
  Items: [{ title: 'リーダブルコード', largeImageUrl: IMAGE_URL, ...overrides }],
})

afterEach(() => {
  vi.unstubAllGlobals()
  // 鍵の有無で分岐するので、他のテストへ漏らさない
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test('リンク先は新しい口 (openapi) で、ISBN と 2 つの鍵が載る', () => {
  // 旧 app.rakuten.co.jp は新しい形式の鍵を知らず、何を送っても 400 (実測)。
  // accessKey は【NEW】で必須。applicationId だけでは通らない
  const url = rakutenBooksUrl('9784873115658', 'my-app-id', 'my-access-key')
  expect(url).toContain(
    'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
  )
  expect(url).toContain('isbn=9784873115658')
  expect(url).toContain('applicationId=my-app-id')
  expect(url).toContain('accessKey=my-access-key')
})

test('応答から書影 URL (largeImageUrl) を取り出す', () => {
  expect(parseRakutenCoverUrl(flat())).toBe(IMAGE_URL)
})

test('formatVersion=1 の形 (Item でラップ) でも取り出せる', () => {
  // formatVersion を指定しているが、外部 API の形は信用しない。
  // 既定に戻されても書影が落ちないようにする
  const wrapped = { Items: [{ Item: { largeImageUrl: IMAGE_URL } }] }
  expect(parseRakutenCoverUrl(wrapped)).toBe(IMAGE_URL)
})

test('大きい書影が無ければ中・小の順に落とす', () => {
  // largeImageUrl でも 200x200。無いよりは 128x128 のほうがまし
  const medium = { Items: [{ largeImageUrl: '', mediumImageUrl: 'https://x.test/m.jpg' }] }
  expect(parseRakutenCoverUrl(medium)).toBe('https://x.test/m.jpg')
})

test('ヒット 0 件は空文字 (書影なし)', () => {
  expect(parseRakutenCoverUrl({ count: 0, hits: 0, Items: [] })).toBe('')
})

test('書影 URL が空の商品は空文字', () => {
  expect(parseRakutenCoverUrl(flat({ largeImageUrl: '' }))).toBe('')
})

test('Items が配列でない・応答が壊れていても空文字 (例外にしない)', () => {
  expect(parseRakutenCoverUrl({ Items: 'not-an-array' })).toBe('')
  expect(parseRakutenCoverUrl(null)).toBe('')
  expect(parseRakutenCoverUrl('<html>error</html>')).toBe('')
  expect(parseRakutenCoverUrl({ Items: [{ largeImageUrl: 42 }] })).toBe('')
})

test('鍵が未設定なら引かずに null (導線は止めない)', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('RAKUTEN_APP_ID', '')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', '')
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url)
    return Promise.resolve(new Response('{}', { status: 200 }))
  })

  await expect(fetchCoverUrl('9784873115658')).resolves.toBeNull()
  expect(calls).toHaveLength(0)
  // 黙ると設定漏れに気づけない
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('RAKUTEN_APP_ID'))
})

test('欠けている設定だけを名指しして引かない', async () => {
  // 3 つ揃わないと引けないうえ、楽天のエラーはどれが悪いか教えてくれない。
  // 「applicationId は入れたのに動かない」で詰まらないよう、こちらで名指しする
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('RAKUTEN_APP_ID', 'my-app-id')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', '')
  vi.stubEnv('RAKUTEN_APP_ORIGIN', 'https://qr.example.jp')
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url)
    return Promise.resolve(new Response('{}', { status: 200 }))
  })

  await expect(fetchCoverUrl('9784873115658')).resolves.toBeNull()
  expect(calls).toHaveLength(0)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('RAKUTEN_ACCESS_KEY'))
  expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('RAKUTEN_APP_ID'))
})

test('設定が揃えば引いて書影 URL を返す。Origin にアプリ登録のサイトを送る', async () => {
  // Origin が無いと 403 (REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING)。
  // Referer では通らない (実測)
  vi.stubEnv('RAKUTEN_APP_ID', 'my-app-id')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'my-access-key')
  vi.stubEnv('RAKUTEN_APP_ORIGIN', 'https://qr.example.jp')
  const init: RequestInit[] = []
  vi.stubGlobal('fetch', (_url: string, options: RequestInit) => {
    init.push(options)
    return Promise.resolve(new Response(JSON.stringify(flat()), { status: 200 }))
  })

  await expect(fetchCoverUrl('9784873115658')).resolves.toBe(IMAGE_URL)
  expect(init[0]?.headers).toEqual({ Origin: 'https://qr.example.jp' })
})

test('設定ミスの原因 (errorMessage) を例外に残す。鍵は載せない', async () => {
  // Origin が登録と違うと HTTP_REFERRER_NOT_ALLOWED が返る。これが
  // 消えると「403 としか分からない」状態で設定を直すことになる
  vi.stubEnv('RAKUTEN_APP_ID', 'my-app-id')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'my-access-key')
  vi.stubEnv('RAKUTEN_APP_ORIGIN', 'https://wrong.example')
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ errors: { errorCode: 403, errorMessage: 'HTTP_REFERRER_NOT_ALLOWED' } }),
        { status: 403 },
      ),
    ),
  )

  const error = await fetchCoverUrl('9784873115658').catch((e: Error) => e)
  expect((error as Error).message).toContain('HTTP_REFERRER_NOT_ALLOWED')
  expect((error as Error).message).not.toContain('my-access-key')
})

test('通信レベルの失敗でも、鍵の入った URL を例外に載せない', async () => {
  // ランタイムの例外をそのまま流すと、その中身がログに出る。
  // いまの undici は URL を載せないが、それに賭けない
  vi.stubEnv('RAKUTEN_APP_ID', 'my-app-id')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'my-access-key')
  vi.stubEnv('RAKUTEN_APP_ORIGIN', 'https://qr.example.jp')
  vi.stubGlobal('fetch', () =>
    Promise.reject(
      new Error(
        'fetch failed: https://openapi.rakuten.co.jp/...?applicationId=my-app-id&accessKey=my-access-key',
      ),
    ),
  )

  const error = await fetchCoverUrl('9784873115658').catch((e: Error) => e)
  expect((error as Error).message).not.toContain('my-app-id')
  expect((error as Error).message).not.toContain('my-access-key')
})

test('HTTP エラーは throw する。URL は載せない (鍵が入っている)', async () => {
  vi.stubEnv('RAKUTEN_APP_ID', 'my-app-id')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'my-access-key')
  vi.stubEnv('RAKUTEN_APP_ORIGIN', 'https://qr.example.jp')
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(JSON.stringify({ statusCode: 429, message: 'Rate limit is exceeded.' }), {
        status: 429,
      }),
    ),
  )
  const error = await fetchCoverUrl('9784873115658').catch((e: Error) => e)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain('429')
  expect((error as Error).message).not.toContain('my-app-id')
  expect((error as Error).message).not.toContain('my-access-key')
})
