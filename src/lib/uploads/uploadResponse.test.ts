import { describe, expect, test } from 'vitest'
import { parseUploadResponse } from './uploadResponse'

describe('parseUploadResponse', () => {
  test('returns the url on a successful response', () => {
    const body = JSON.stringify({ success: true, data: { url: '/api/images/a.png' } })
    expect(parseUploadResponse(200, body)).toBe('/api/images/a.png')
  })

  test('throws the server-supplied error message on failure', () => {
    const body = JSON.stringify({ success: false, error: '画像が大きすぎます' })
    expect(() => parseUploadResponse(400, body)).toThrow('画像が大きすぎます')
  })

  test('falls back to the HTTP status when the body has no error message', () => {
    expect(() => parseUploadResponse(500, '')).toThrow(
      'アップロードに失敗しました (HTTP 500)',
    )
  })

  test('throws on unparsable body even with a 2xx status', () => {
    expect(() => parseUploadResponse(200, '<html>proxy error</html>')).toThrow(
      'アップロードに失敗しました (HTTP 200)',
    )
  })

  test('treats success:false with a 2xx status as a failure', () => {
    const body = JSON.stringify({ success: false, error: '認証が必要です' })
    expect(() => parseUploadResponse(200, body)).toThrow('認証が必要です')
  })

  // `![](undefined)` が本文に入るのを防ぐ (壊れたリンクが黙って保存される)
  test('throws when a successful response carries no url', () => {
    const body = JSON.stringify({ success: true, data: {} })
    expect(() => parseUploadResponse(200, body)).toThrow('画像 URL がありません')
  })

  test('throws when data itself is missing', () => {
    expect(() => parseUploadResponse(200, JSON.stringify({ success: true }))).toThrow(
      '画像 URL がありません',
    )
  })
})
