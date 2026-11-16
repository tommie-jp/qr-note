import { describe, expect, test } from 'vitest'
import { apiOkGzip, apiOkPagedGzip, brotliQualityFor, BROTLI_LARGE_BYTES, compressedTextResponse } from './compress'

const request = (acceptEncoding?: string) =>
  new Request('http://localhost/api/sync/items', {
    headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  })

// Next 16.4.5 から Route Handler の Content-Encoding は送出時に捨てられる
// (GHSA-pc58-hwjq-p385)。自前で圧縮すると壊れるので、本文は素のまま返し
// 圧縮は next start に任せる (compress.ts の冒頭)
describe('apiOkGzip', () => {
  test.each(['gzip, deflate, br', 'gzip', 'identity', undefined])(
    'Accept-Encoding が %s でも圧縮せず素の封筒を返す',
    async (accept) => {
      // Arrange
      const data = { items: ['a'.repeat(5000)] }

      // Act
      const res = await apiOkGzip(data, request(accept))

      // Assert
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Encoding')).toBeNull()
      expect(res.headers.get('Vary')).toBe('Accept-Encoding')
      expect(res.headers.get('Content-Type')).toBe('application/json')
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(await res.json()).toEqual({ success: true, data, error: null })
    },
  )

  test('足したヘッダ (ETag) を載せる', async () => {
    const res = await apiOkGzip({}, request('gzip'), { ETag: '"v1"' })
    expect(res.headers.get('ETag')).toBe('"v1"')
  })
})

describe('apiOkPagedGzip (docs/123 §11-6)', () => {
  test('meta 付きの封筒を圧縮せずに返す', async () => {
    // Arrange
    const big = { items: 'x'.repeat(5000) }
    const meta = { total: 41, page: 1, pageCount: 3 }

    // Act
    const res = await apiOkPagedGzip(big, meta, request('gzip, br'))

    // Assert
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.json()).toEqual({ success: true, data: big, error: null, meta })
  })
})

describe('compressedTextResponse', () => {
  test('本文と渡したヘッダをそのまま返し、Vary を足す', async () => {
    // Act
    const res = await compressedTextResponse('<svg/>'.repeat(500), request('br'), {
      'Content-Type': 'image/svg+xml',
    })

    // Assert
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
    expect(await res.text()).toBe('<svg/>'.repeat(500))
  })
})

describe('brotli の品質 (docs/124 §8、ベンチ用)', () => {
  test('1MB 未満は品質 5、1MB 以上は品質 3', () => {
    expect(brotliQualityFor(BROTLI_LARGE_BYTES - 1)).toBe(5)
    expect(brotliQualityFor(BROTLI_LARGE_BYTES)).toBe(3)
  })
})
