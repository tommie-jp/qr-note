import { afterEach, expect, test } from 'vitest'
import { maxUploadBytes, MULTIPART_OVERHEAD_BYTES } from './limits'
import { checkUploadRequest } from './request'

const originalDemo = process.env.DEMO_MODE

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

function uploadRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/images', {
    method: 'POST',
    body: new FormData(),
    headers,
  })
}

// 本文の事前チェック (Content-Length) もデモ上限で効くこと。
// 通常なら通る 5MB が、デモでは 2MB を超えるので 413 で弾かれる
test('checkUploadRequest の本文上限もデモでは 2MB に縮む', () => {
  const fiveMB = String(5 * 1024 * 1024)

  delete process.env.DEMO_MODE
  expect(
    checkUploadRequest(uploadRequest({ host: 'localhost', 'content-length': fiveMB })),
  ).toBeNull()

  process.env.DEMO_MODE = '1'
  expect(
    checkUploadRequest(uploadRequest({ host: 'localhost', 'content-length': fiveMB }))
      ?.status,
  ).toBe(413)
})

test('Origin がないリクエスト (curl 等) は通す', () => {
  expect(checkUploadRequest(uploadRequest({ host: 'localhost' }))).toBeNull()
})

test('同一オリジンの POST は通す', () => {
  const request = uploadRequest({ origin: 'http://localhost', host: 'localhost' })
  expect(checkUploadRequest(request)).toBeNull()
})

test('クロスオリジンの POST は 403 で弾く (CSRF)', () => {
  const request = uploadRequest({
    origin: 'https://evil.example.com',
    host: 'localhost',
  })
  expect(checkUploadRequest(request)?.status).toBe(403)
})

test('Origin が壊れていても例外にせず 403 で弾く', () => {
  const request = uploadRequest({ origin: 'not-a-url', host: 'localhost' })
  expect(checkUploadRequest(request)?.status).toBe(403)
})

test('Content-Length が上限を超えていれば本文を読まず 413 で弾く', () => {
  const request = uploadRequest({
    host: 'localhost',
    'content-length': String(100 * 1024 * 1024),
  })
  expect(checkUploadRequest(request)?.status).toBe(413)
})

test('Content-Length が上限内なら通す', () => {
  const request = uploadRequest({
    host: 'localhost',
    'content-length': String(1024),
  })
  expect(checkUploadRequest(request)).toBeNull()
})

// **この門と Next.js の proxy が本文を複製できる量が同じであること。**
//
// proxy (src/proxy.ts) を通るルートは、Next.js が本文をメモリへ複製し、
// experimental.proxyClientMaxBodySize を超えたぶんは**黙って捨てる**
// (応答はエラーにならない。next.config.ts の同項の注)。複製の上限がこの門より
// 小さいと、門を通った本文が route の手前で千切れ、formData() が
// 「境界の閉じない multipart」として落ちる — ユーザーには大きさの話だと
// 分からない 400 しか出ない (実際にこれで動画 (10〜30MB) が入らなかった)。
//
// 同じ値にしておけば「本文が切られるのは 413 で断った後だけ」になる。
// 片方だけ動かすとその不具合が戻るので、ここで両者を突き合わせる
test('proxy の本文複製の上限は checkUploadRequest の門以上である', async () => {
  delete process.env.DEMO_MODE
  const nextConfig = (await import('../../../next.config')).default
  expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(
    maxUploadBytes() + MULTIPART_OVERHEAD_BYTES,
  )
})
