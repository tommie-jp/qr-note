import { afterEach, expect, test, vi } from 'vitest'
import { saveCoverImage } from './coverImage'

// 保存は差し替える。ここで見たいのは「取得 → 保存 → URL」のつなぎ方で、
// DB そのものではない (import すると db.ts が DATABASE_URL を要求する)
const { saveImage } = vi.hoisted(() => ({
  saveImage: vi.fn(async () => '/api/images/0198ee1a-2b3c-4d5e-8f90-1a2b3c4d5e6f.jpg'),
}))
vi.mock('../imageStore', () => ({ saveImage }))

const OPENBD_COVER = 'https://cover.openbd.jp/9784861827754.jpg'

const jpegBytes = () => {
  const bytes = new Uint8Array(64)
  bytes.set([0xff, 0xd8, 0xff])
  return bytes
}

const imageResponse = () =>
  new Response(jpegBytes(), { status: 200, headers: { 'content-type': 'image/jpeg' } })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
  saveImage.mockClear()
})

test('書影が取れたら保存して本文に置く URL を返す', async () => {
  vi.stubGlobal('fetch', () => Promise.resolve(imageResponse()))

  await expect(saveCoverImage('9784861827754', OPENBD_COVER)).resolves.toBe(
    '/api/images/0198ee1a-2b3c-4d5e-8f90-1a2b3c4d5e6f.jpg',
  )
  expect(saveImage).toHaveBeenCalledWith(jpegBytes(), 'image/jpeg', 'jpg')
})

test('書影が無ければ undefined。保存もしない', async () => {
  vi.stubEnv('RAKUTEN_APP_ID', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response('', { status: 404 })),
  )

  await expect(saveCoverImage('9784873115658', OPENBD_COVER)).resolves.toBeUndefined()
  expect(saveImage).not.toHaveBeenCalled()
})

test('保存に失敗しても throw しない (書誌を道連れにしない)', async () => {
  // DB が落ちていても書名・著者の事前入力は届かせる (docs/19-書影取得計画.md §3)。
  // ただし自分のところの故障なので、外部 API の「無かった」と混ぜず
  // エラーとして・どの本かが分かる形で残す
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', () => Promise.resolve(imageResponse()))
  saveImage.mockRejectedValueOnce(new Error('DB が落ちている'))

  await expect(saveCoverImage('9784861827754', OPENBD_COVER)).resolves.toBeUndefined()
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('9784861827754'),
    expect.any(Error),
  )
})

test('取得が黙り込んでも上限で打ち切る (書誌の事前入力を待たせ続けない)', async () => {
  // 上限を取得元ごとに持たせると、全部が黙り込んだとき書名すら出ないまま
  // 20 秒以上待たせることになる。書影ぜんぶで 5 秒に切ってある
  vi.useFakeTimers()
  vi.stubEnv('RAKUTEN_APP_ID', 'my-app-id')
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'my-access-key')
  vi.stubEnv('RAKUTEN_APP_ORIGIN', 'https://qr.example.jp')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // 応答を返さず、中断されたときだけ失敗する口
  vi.stubGlobal('fetch', (_url: string, options: RequestInit) => {
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('中断')))
    })
  })

  const promise = saveCoverImage('9784861827754', OPENBD_COVER)
  await vi.advanceTimersByTimeAsync(5000)

  await expect(promise).resolves.toBeUndefined()
  expect(saveImage).not.toHaveBeenCalled()
})
