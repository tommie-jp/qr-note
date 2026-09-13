import { afterEach, expect, test, vi } from 'vitest'
import { isAllowedCoverUrl, lookupCover } from './coverLookup'
import { MAX_IMAGE_BYTES } from './uploads/limits'

const OPENBD_COVER = 'https://cover.openbd.jp/9784861827754.jpg'
const RAKUTEN_COVER =
  'https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/5658/9784873115658.jpg?_ex=200x200'

// 先頭バイトが JPEG の署名になっている中身 (sniffImageFormat が jpg と判定する)
const jpegBytes = (size = 64) => {
  const bytes = new Uint8Array(size)
  bytes.set([0xff, 0xd8, 0xff])
  return bytes
}

const imageResponse = (bytes = jpegBytes()) =>
  new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })

const rakutenResponse = (largeImageUrl: string) =>
  new Response(JSON.stringify({ Items: [{ largeImageUrl }] }), { status: 200 })

afterEach(() => {
  vi.unstubAllGlobals()
  // 鍵の有無で分岐するので、他のテストへ漏らさない
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test('許可したホストの https だけを取りに行く', () => {
  expect(isAllowedCoverUrl(OPENBD_COVER)).toBe(true)
  expect(isAllowedCoverUrl(RAKUTEN_COVER)).toBe(true)
})

test('許可外のホストは拒む (外部 API の応答に書かれた URL を信用しない)', () => {
  // openBD / 楽天の応答が壊れた・乗っ取られたとき、このサーバが
  // 任意の URL を叩く踏み台になる
  expect(isAllowedCoverUrl('https://evil.example/x.jpg')).toBe(false)
  expect(isAllowedCoverUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
  expect(isAllowedCoverUrl('https://localhost/x.jpg')).toBe(false)
})

test('許可ホストを名前に含むだけの別ホストは拒む', () => {
  // 前方・後方一致で許すと、この形が通ってしまう
  expect(isAllowedCoverUrl('https://evil.example/cover.openbd.jp/x.jpg')).toBe(false)
  expect(isAllowedCoverUrl('https://cover.openbd.jp.evil.example/x.jpg')).toBe(false)
  expect(isAllowedCoverUrl('https://evil-rakuten.co.jp/x.jpg')).toBe(false)
})

test('https 以外・URL でない値は拒む', () => {
  expect(isAllowedCoverUrl('http://cover.openbd.jp/x.jpg')).toBe(false)
  expect(isAllowedCoverUrl('file:///etc/passwd')).toBe(false)
  expect(isAllowedCoverUrl('not a url')).toBe(false)
  expect(isAllowedCoverUrl('')).toBe(false)
})

test('openBD の書影 URL があればそれを取り、楽天は叩かない', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url)
    return Promise.resolve(imageResponse())
  })

  const cover = await lookupCover('9784861827754', OPENBD_COVER)
  expect(cover).toEqual({ bytes: jpegBytes(), mime: 'image/jpeg', ext: 'jpg' })
  expect(calls).toEqual([OPENBD_COVER])
})

test('openBD に書影が無ければ楽天で拾う', async () => {
  // 実測では openBD の cover はホワイトリスト版元のみ (11 冊中 1 冊)。
  // 楽天を足した理由そのもの (docs/19-書影取得計画.md §1)
  vi.stubEnv('RAKUTEN_APP_ID', 'my-app-id')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'my-access-key')
  vi.stubEnv('RAKUTEN_APP_ORIGIN', 'https://qr.example.jp')
  vi.stubGlobal('fetch', (url: string) =>
    Promise.resolve(
      url.includes('rakuten.co.jp/services')
        ? rakutenResponse(RAKUTEN_COVER)
        : imageResponse(),
    ),
  )

  const cover = await lookupCover('9784873115658')
  expect(cover?.mime).toBe('image/jpeg')
})

test('どこにも書影が無ければ null (エラーではない)', async () => {
  vi.stubEnv('RAKUTEN_APP_ID', 'my-app-id')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'my-access-key')
  vi.stubEnv('RAKUTEN_APP_ORIGIN', 'https://qr.example.jp')
  vi.stubGlobal('fetch', () => Promise.resolve(rakutenResponse('')))
  await expect(lookupCover('9784873115658')).resolves.toBeNull()
})

test('404 は書影なし (本文をそのまま画像にしない)', async () => {
  // 版元ドットコムは書影が無いとき 404 + プレースホルダ JPEG を返す。
  // ステータスを見ずにマジックバイトだけで判定すると掴んでしまう
  vi.stubEnv('RAKUTEN_APP_ID', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(jpegBytes(), { status: 404, headers: { 'content-type': 'image/jpeg' } }),
    ),
  )
  await expect(lookupCover('9784873115658', OPENBD_COVER)).resolves.toBeNull()
})

test('403 や 5xx は書影なしにせず警告を残す (塞がれたことに気づけなくなる)', async () => {
  // 「書影が無い」のではなく訊けていない。404 と同じ null に混ぜると、
  // ホストに塞がれても書影が出ないだけの状態が黙って続く。
  // NDL の書影 API は終了後、自サイト以外に 403 を返すようになった (実測)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('RAKUTEN_APP_ID', '')
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response('<html>Request blocked</html>', { status: 403 })),
  )

  await expect(lookupCover('9784873115658', OPENBD_COVER)).resolves.toBeNull()
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('openBD'),
    expect.objectContaining({ message: expect.stringContaining('403') }),
  )
})

test('取得元の 1 つが塞がれても、次の取得元は試す', async () => {
  // openBD の CDN が落ちている間も、楽天から書影が入る
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('RAKUTEN_APP_ID', 'my-app-id')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'my-access-key')
  vi.stubEnv('RAKUTEN_APP_ORIGIN', 'https://qr.example.jp')
  vi.stubGlobal('fetch', (url: string) => {
    if (url === OPENBD_COVER) {
      return Promise.resolve(new Response('', { status: 503 }))
    }
    return Promise.resolve(
      url.includes('rakuten.co.jp/services') ? rakutenResponse(RAKUTEN_COVER) : imageResponse(),
    )
  })

  const cover = await lookupCover('9784873115658', OPENBD_COVER)
  expect(cover?.mime).toBe('image/jpeg')
})

test('200 でも中身が画像でなければ書影なし', async () => {
  // Content-Type を信用せず中身を見る (アップロード経路と同じ検査)
  vi.stubEnv('RAKUTEN_APP_ID', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(new TextEncoder().encode('<html>error</html>'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    ),
  )
  await expect(lookupCover('9784873115658', OPENBD_COVER)).resolves.toBeNull()
})

test('対応していない画像形式は書影なし', async () => {
  // Content-Type ではなく中身で判定する。image/jpeg を名乗る SVG の実体を
  // 送っても、先頭バイトが SVG (=非対応) なら書影にしない
  vi.stubEnv('RAKUTEN_APP_ID', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    ),
  )
  await expect(lookupCover('9784873115658', OPENBD_COVER)).resolves.toBeNull()
})

test('大きすぎる画像は取り込まない', async () => {
  vi.stubEnv('RAKUTEN_APP_ID', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(jpegBytes(), {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(MAX_IMAGE_BYTES + 1),
        },
      }),
    ),
  )
  await expect(lookupCover('9784873115658', OPENBD_COVER)).resolves.toBeNull()
})

test('Content-Length が無くても、上限を超えた時点で受信をやめる', async () => {
  // Content-Length は申告でしかなく、chunked では付かない。それを頼りに
  // 「読み切ってから大きさを見る」と、上限を宣言していてもメモリに
  // 全部載せてしまう
  let pulled = 0
  let cancelled = false
  const endless = new ReadableStream({
    pull(controller) {
      pulled += 1
      controller.enqueue(new Uint8Array(1024 * 1024)) // 1MB ずつ、いくらでも
    },
    cancel() {
      cancelled = true
    },
  })
  vi.stubEnv('RAKUTEN_APP_ID', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(endless, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    ),
  )

  await expect(lookupCover('9784873115658', OPENBD_COVER)).resolves.toBeNull()
  expect(cancelled).toBe(true)
  // 上限 (10MB) を少し超えたところで止まる。最後まで読まない
  expect(pulled).toBeLessThanOrEqual(MAX_IMAGE_BYTES / 1024 / 1024 + 2)
})

test('リダイレクトは追わない (許可ホストから別ホストへ飛ばされない)', async () => {
  const init: RequestInit[] = []
  vi.stubEnv('RAKUTEN_APP_ID', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', (_url: string, options: RequestInit) => {
    init.push(options)
    return Promise.resolve(imageResponse())
  })

  await lookupCover('9784861827754', OPENBD_COVER)
  expect(init[0]?.redirect).toBe('error')
})

test('許可外の URL を渡されても取りに行かない', async () => {
  const calls: string[] = []
  vi.stubEnv('RAKUTEN_APP_ID', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url)
    return Promise.resolve(imageResponse())
  })

  await expect(lookupCover('9784873115658', 'https://evil.example/x.jpg')).resolves.toBeNull()
  expect(calls).toHaveLength(0)
})

test('書影の取得に失敗しても throw しない (書誌を道連れにしない)', async () => {
  // 書誌が本体、書影はおまけ。この順位を崩さない (docs/19 §3)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('RAKUTEN_APP_ID', 'my-app-id')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'my-access-key')
  vi.stubEnv('RAKUTEN_APP_ORIGIN', 'https://qr.example.jp')
  vi.stubGlobal('fetch', () => Promise.reject(new Error('通信断')))

  await expect(lookupCover('9784873115658', OPENBD_COVER)).resolves.toBeNull()
  // 握り潰さずに残す
  expect(warn).toHaveBeenCalled()
})
