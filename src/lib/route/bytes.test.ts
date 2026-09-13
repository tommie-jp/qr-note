import { describe, expect, test } from 'vitest'
import { byteHeaders, bytesResponse, rangedBytesResponse } from './bytes'

// バイト列の応答 (docs/93-リファクタリング計画.md §3-3)。
// ヘッダは Headers にして比べる (名前の大小と並びは HTTP では意味を持たない)

const DATA = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

function rangeRequest(range?: string): Request {
  return new Request('http://localhost/api/images/a.wav', {
    headers: range === undefined ? {} : { range },
  })
}

describe('byteHeaders', () => {
  test('種別・キャッシュ・nosniff を揃える', () => {
    expect(byteHeaders({ contentType: 'application/zip', cacheControl: 'no-store' })).toEqual({
      'Content-Type': 'application/zip',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
  })

  test('noindex と口ごとのヘッダを足せる', () => {
    const headers = byteHeaders({
      contentType: 'image/png',
      cacheControl: 'private, max-age=60',
      noindex: true,
      extra: { 'x-secret-mime': 'image/png' },
    })

    expect(headers).toEqual({
      'Content-Type': 'image/png',
      'x-secret-mime': 'image/png',
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    })
  })
})

describe('bytesResponse', () => {
  test('全体を 200 で、渡したヘッダのまま返す', async () => {
    const res = bytesResponse(DATA, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })

    expect(res.status).toBe(200)
    expect(Object.fromEntries(res.headers)).toEqual({
      'cache-control': 'no-store',
      'content-type': 'image/png',
    })
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(DATA)
  })
})

describe('rangedBytesResponse', () => {
  const headers = { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }

  test('Range が無ければ全体を 200 (Accept-Ranges で部分取得できると知らせる)', async () => {
    // Act
    const res = rangedBytesResponse(rangeRequest(), DATA, headers)

    // Assert
    expect(res.status).toBe(200)
    expect(Object.fromEntries(res.headers)).toEqual({
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'content-type': 'audio/wav',
    })
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(DATA)
  })

  test('範囲内なら 206 でその部分だけ返す', async () => {
    const res = rangedBytesResponse(rangeRequest('bytes=2-5'), DATA, headers)

    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([2, 3, 4, 5])
  })

  test('範囲外なら 416 で全長を知らせる (本文なし)', async () => {
    const res = rangedBytesResponse(rangeRequest('bytes=20-30'), DATA, headers)

    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
    expect(res.headers.get('content-type')).toBe('audio/wav')
    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })
})
