import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ApiError,
  envelopeData,
  fetchEnvelope,
  NETWORK_ERROR_MESSAGE,
  openEnvelope,
} from './envelope'

// 封筒の読み手 (docs/93-リファクタリング計画.md §3-1)。

describe('openEnvelope', () => {
  test('2xx かつ success: true なら data を返す', () => {
    expect(openEnvelope(200, { success: true, data: { url: '/a.png' }, error: null })).toEqual({
      ok: true,
      data: { url: '/a.png' },
    })
  })

  test('2xx でも success が true でなければ失敗 (サーバの文言を持つ)', () => {
    expect(openEnvelope(200, { success: false, data: null, error: '認証が必要です' })).toEqual({
      ok: false,
      error: '認証が必要です',
    })
  })

  test('2xx 以外は success に関わらず失敗', () => {
    expect(openEnvelope(500, { success: true, data: 1, error: null })).toEqual({
      ok: false,
      error: null,
    })
  })

  test('オブジェクトでない本文は文言なしの失敗', () => {
    for (const body of [null, 'text', 42, undefined]) {
      expect(openEnvelope(200, body), String(body)).toEqual({ ok: false, error: null })
    }
  })

  test('空文字の error はそのまま渡す (既定の文言へ落とすかは読み手が決める)', () => {
    expect(openEnvelope(400, { success: false, error: '' })).toEqual({ ok: false, error: '' })
  })
})

describe('envelopeData', () => {
  test('data を取り出す (成否は見ない)', () => {
    expect(envelopeData({ success: false, data: { saved: [] } })).toEqual({ saved: [] })
  })

  test('data が無い・本文がオブジェクトでなければ null', () => {
    expect(envelopeData({ success: true })).toBeNull()
    expect(envelopeData(null)).toBeNull()
    expect(envelopeData('data')).toBeNull()
  })
})

describe('fetchEnvelope', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function respond(status: number, body: string): void {
    fetchMock.mockResolvedValue(new Response(body, { status }))
  }

  test('成功なら data を返し、Cookie を送る設定で叩く', async () => {
    // Arrange
    respond(200, JSON.stringify({ success: true, data: { userName: 'tommie' }, error: null }))

    // Act
    const data = await fetchEnvelope<{ userName: string }>('/api/x', { method: 'POST', body: '{}' })

    // Assert
    expect(data).toEqual({ userName: 'tommie' })
    expect(fetchMock).toHaveBeenCalledWith('/api/x', {
      method: 'POST',
      body: '{}',
      credentials: 'same-origin',
    })
  })

  test('断られたらサーバの文言と status で ApiError', async () => {
    respond(404, JSON.stringify({ success: false, data: null, error: 'パスキーがまだ登録されていません' }))

    const error = await fetchEnvelope('/api/x', {}).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ message: 'パスキーがまだ登録されていません', status: 404 })
  })

  test('文言が無ければ status 付きの既定の文言', async () => {
    respond(500, JSON.stringify({ success: false, data: null, error: '' }))

    await expect(fetchEnvelope('/api/x', {})).rejects.toMatchObject({
      message: '処理に失敗しました (500)',
      status: 500,
    })
  })

  test('JSON でない応答 (中継の HTML など) は黙って無視せず ApiError', async () => {
    respond(502, '<html>Bad Gateway</html>')

    await expect(fetchEnvelope('/api/x', {})).rejects.toMatchObject({
      message: 'サーバから予期しない応答が返りました (502)',
      status: 502,
    })
  })

  test('通信そのものが失敗したら status 0 で、原因はログに残す', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = await fetchEnvelope('/api/x', {}).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ message: NETWORK_ERROR_MESSAGE, status: 0 })
    expect(consoleError).toHaveBeenCalledWith('/api/x への通信に失敗しました', expect.any(TypeError))
  })
})
