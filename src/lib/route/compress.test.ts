import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { apiOkGzip } from './compress'

const request = (acceptEncoding?: string) =>
  new Request('http://localhost/api/sync/items', {
    headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  })

describe('apiOkGzip', () => {
  test('gzip を受ける相手には圧縮して返し、展開すると素の封筒と同じ', async () => {
    const res = await apiOkGzip({ items: ['a'.repeat(1000)] }, request('gzip, deflate, br'))

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
