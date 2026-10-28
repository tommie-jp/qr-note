import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { apiOkGzip } from './compress'

const request = (acceptEncoding?: string) =>
  new Request('http://localhost/api/sync/items', {
    headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  })

describe('apiOkGzip', () => {
  test('gzip を受ける相手には圧縮して返し、展開すると素の封筒と同じ', async () => {
    const res = apiOkGzip({ items: ['a'.repeat(1000)] }, request('gzip, deflate, br'))

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
    const res = apiOkGzip({ ok: 1 }, request('identity'))

    expect(res.headers.get('Content-Encoding')).toBeNull()
    expect(await res.json()).toEqual({ success: true, data: { ok: 1 }, error: null })
  })

  test('Accept-Encoding が無ければ素の封筒', async () => {
    const res = apiOkGzip({ ok: 1 }, request())

    expect(res.headers.get('Content-Encoding')).toBeNull()
  })

  test('足したヘッダ (ETag) をどちらの応答にも載せる', () => {
    const headers = { ETag: '"v1"' }
    expect(apiOkGzip({}, request('gzip'), headers).headers.get('ETag')).toBe('"v1"')
    expect(apiOkGzip({}, request(), headers).headers.get('ETag')).toBe('"v1"')
  })
})
