import { afterEach, expect, test, vi } from 'vitest'
import type { BookSummary } from './book'
import { lookupBook } from './bookLookup'

// fetch を差し替えて、2 つの API の応答の組み合わせだけを見る。
// どの API を何順で叩くかは実装の関心なので、ここでは URL で見分ける
const openBdBook = (title: string) =>
  JSON.stringify([{ summary: { title, publisher: '', pubdate: '', author: '' } }])

const ndlBook = (title: string) =>
  `<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item>
     <dc:title>${title}</dc:title></item></channel></rss>`

const NOT_FOUND_OPENBD = JSON.stringify([null])
const NOT_FOUND_NDL = '<rss><channel></channel></rss>'

function mockApis(openbd: string | Error, ndl: string | Error) {
  vi.stubGlobal('fetch', (url: string) => {
    const body = url.includes('openbd') ? openbd : ndl
    if (body instanceof Error) {
      return Promise.reject(body)
    }
    return Promise.resolve(new Response(body, { status: 200 }))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('openBD にあれば NDL は叩かない', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url)
    return Promise.resolve(new Response(openBdBook('新しい本'), { status: 200 }))
  })
  const book = await lookupBook('9784873115658')
  expect(book?.title).toBe('新しい本')
  expect(calls).toHaveLength(1)
  expect(calls[0]).toContain('openbd')
})

test('openBD に無ければ NDL で拾う (古い本)', async () => {
  // この機能を足した理由そのもの。openBD は 1990 年代の本をほぼ持たない
  mockApis(NOT_FOUND_OPENBD, ndlBook('アーキテクチャとプログラミングの基礎'))
  const book = await lookupBook('9784756116291')
  expect(book?.title).toBe('アーキテクチャとプログラミングの基礎')
})

test('どちらにも無ければ null (エラーではない)', async () => {
  mockApis(NOT_FOUND_OPENBD, NOT_FOUND_NDL)
  await expect(lookupBook('9784999999999')).resolves.toBeNull()
})

test('片方が失敗しても、もう片方で見つかれば返す', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockApis(new Error('openBD が落ちている'), ndlBook('NDL で拾えた本'))
  const book = await lookupBook('9784756116291')
  expect(book?.title).toBe('NDL で拾えた本')
})

test('失敗したまま見つからなければ throw する (null と区別する)', async () => {
  // タイムアウトや通信断を null にすると「見つかりませんでした」と
  // 断定して伝えることになる。実際には訊けていないだけで、
  // その本が無いことは分かっていない
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockApis(NOT_FOUND_OPENBD, new Error('NDL がタイムアウト'))
  await expect(lookupBook('9784756116291')).rejects.toThrow(
    'どの書誌 API からも取得できませんでした',
  )
})

test('個々の API の失敗は握り潰さず警告に残す', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockApis(new Error('openBD が落ちている'), ndlBook('本'))
  await lookupBook('9784756116291')
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('openBD'),
    expect.any(Error),
  )
})

test('HTTP エラーは失敗として扱う (本文を書誌として読まない)', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response('<html>503</html>', { status: 503 })),
  )
  await expect(lookupBook('9784756116291')).rejects.toThrow()
})

test('中断されたら次の API を叩かない', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url)
    return Promise.resolve(new Response(NOT_FOUND_OPENBD, { status: 200 }))
  })
  const abort = new AbortController()
  const promise: Promise<BookSummary | null> = lookupBook('9784756116291', abort.signal)
  abort.abort('unmount')
  await promise.catch(() => {})
  // openBD の 1 回で止まる (NDL には行かない)
  expect(calls.length).toBeLessThanOrEqual(1)
})
