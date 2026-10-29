import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { apiOkGzip } from './compress'

const request = (acceptEncoding?: string) =>
  new Request('http://localhost/api/sync/items', {
    headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  })

describe('apiOkGzip', () => {
  test('gzip を受ける相手には圧縮して返し、展開すると素の封筒と同じ', async () => {
    const res = await apiOkGzip({ items: ['a'.repeat(1000)] }, request('gzip, deflate'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Encoding')).toBe('gzip')
    expect(res.headers.get('Vary')).toBe('Accept-Encoding')
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const raw = Buffer.from(await res.arrayBuffer())
    expect(raw.byteLength).toBeLessThan(200)
    expect(JSON.parse(gunzipSync(raw).toString('utf8'))).toEqual({
      success: true,
      data: { items: ['a'.repeat(1000)] },
      error: null,
    })
  })

  test('gzip を受けない相手には素の封筒を返す', async () => {
    const res = await apiOkGzip({ ok: 1 }, request('identity'))

    expect(res.headers.get('Content-Encoding')).toBeNull()
    expect(await res.json()).toEqual({ success: true, data: { ok: 1 }, error: null })
  })

  test('Accept-Encoding が無ければ素の封筒', async () => {
    const res = await apiOkGzip({ ok: 1 }, request())

    expect(res.headers.get('Content-Encoding')).toBeNull()
  })

  test('足したヘッダ (ETag) をどちらの応答にも載せる', async () => {
    const headers = { ETag: '"v1"' }
    expect((await apiOkGzip({}, request('gzip'), headers)).headers.get('ETag')).toBe('"v1"')
    expect((await apiOkGzip({}, request(), headers)).headers.get('ETag')).toBe('"v1"')
  })
})

test('圧縮は SYNC_GZIP_LEVEL の強さで行い、展開すると元に戻る', async () => {
  const { gunzipSync, gzipSync } = await import('node:zlib')
  const { SYNC_GZIP_LEVEL } = await import('./compress')
  const data = { items: Array.from({ length: 300 }, (_, i) => `note ${i} ${'回路 '.repeat(i % 17)}`) }

  const res = await apiOkGzip(data, request('gzip'))
  const body = Buffer.from(await res.arrayBuffer())

  expect(SYNC_GZIP_LEVEL).toBe(4)
  expect(JSON.parse(gunzipSync(body).toString())).toEqual({ success: true, data, error: null })
  const plain = JSON.stringify({ success: true, data, error: null })
  expect(body.byteLength).toBe(gzipSync(plain, { level: SYNC_GZIP_LEVEL }).byteLength)
})

describe('apiOkPagedGzip (docs/123 §11-6)', () => {
  const big = { items: 'x'.repeat(5000) }
  const meta = { total: 41, page: 1, pageCount: 3 }

  test('gzip を受ける相手には meta 付きの封筒を圧縮して返す', async () => {
    // Arrange
    const { apiOkPagedGzip } = await import('./compress')
    const request = new Request('http://localhost/api/items', { headers: { 'accept-encoding': 'gzip, deflate' } })

    // Act
    const res = await apiOkPagedGzip(big, meta, request)

    // Assert
    expect(res.headers.get('content-encoding')).toBe('gzip')
    const { gunzipSync } = await import('node:zlib')
    const body = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString())
    expect(body).toEqual({ success: true, data: big, error: null, meta })
  })

  test('小さな本文は圧縮しない', async () => {
    // Arrange
    const { apiOkPagedGzip } = await import('./compress')
    const request = new Request('http://localhost/api/items', { headers: { 'accept-encoding': 'gzip' } })

    // Act
    const res = await apiOkPagedGzip({ items: [] }, meta, request)

    // Assert
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.json()).toEqual({ success: true, data: { items: [] }, error: null, meta })
  })
})

describe('brotli の品質 (docs/124 §8)', () => {
  test('1MB 未満は品質 5、1MB 以上は品質 3', async () => {
    const { brotliQualityFor, BROTLI_LARGE_BYTES } = await import('./compress')
    expect(brotliQualityFor(BROTLI_LARGE_BYTES - 1)).toBe(5)
    expect(brotliQualityFor(BROTLI_LARGE_BYTES)).toBe(3)
  })
})

describe('brotli (docs/124 §3)', () => {
  const big = { items: 'x'.repeat(5000) }

  test('br を受ける相手には brotli で返し、展開すると素の封筒と同じ', async () => {
    // Arrange
    const { brotliDecompressSync } = await import('node:zlib')

    // Act
    const res = await apiOkGzip(big, request('gzip, deflate, br'))

    // Assert
    expect(res.headers.get('Content-Encoding')).toBe('br')
    expect(res.headers.get('Vary')).toBe('Accept-Encoding')
    const body = JSON.parse(brotliDecompressSync(Buffer.from(await res.arrayBuffer())).toString())
    expect(body).toEqual({ success: true, data: big, error: null })
  })

  test.each([
    ['br;q=0 は受けないので gzip', 'br;q=0, gzip', 'gzip'],
    ['大文字でも読む', 'GZIP', 'gzip'],
    ['どちらも受けなければ符号化しない', 'identity', null],
    ['gzip;q=0.5 は受ける', 'gzip;q=0.5', 'gzip'],
  ])('%s', async (_label, accept, expected) => {
    // Act
    const res = await apiOkGzip(big, request(accept))

    // Assert
    expect(res.headers.get('Content-Encoding')).toBe(expected)
  })
})
