import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, apiGet, apiSend, isAbortError, setUnauthorizedHandler } from './api'

// 端末から JSON API を呼ぶ入口 (docs/123 §3-1)。封筒の剥がし方と、失敗の
// 投げ方 (状態コード・文言) を固定する

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })),
  )
}

let unauthorized = 0

beforeEach(() => {
  unauthorized = 0
  setUnauthorizedHandler(() => {
    unauthorized += 1
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiGet / apiSend', () => {
  test('成功の封筒は data と meta を返す', async () => {
    // Arrange
    respond(200, { success: true, data: { a: 1 }, error: null, meta: { total: 3 } })

    // Act
    const result = await apiGet('/api/x')

    // Assert
    expect(result).toEqual({ data: { a: 1 }, meta: { total: 3 } })
  })

  test('失敗の封筒は文言と状態コードを持つ ApiError で投げる', async () => {
    // Arrange
    respond(409, { success: false, data: null, error: '本文が変わっています' })

    // Act
    const error = await apiSend('PATCH', '/api/x', { line: 1 }).catch((e: unknown) => e)

    // Assert
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, message: '本文が変わっています' })
  })

  test('文言の無い失敗は状態コードを添えた定型文にする', async () => {
    // Arrange
    respond(500, { success: false, data: null, error: null })

    // Act / Assert
    await expect(apiGet('/api/x')).rejects.toThrow('失敗しました (500)')
  })

  test('JSON でない応答は読めないと断る', async () => {
    // Arrange
    respond(502, '<html>Bad Gateway</html>')

    // Act / Assert
    await expect(apiGet('/api/x')).rejects.toThrow('応答を読めませんでした (502)')
  })

  test('401 は画面を読み直させてから投げる', async () => {
    // Arrange
    respond(401, { success: false, data: null, error: 'ログインが必要です' })

    // Act
    const error = await apiGet('/api/x').catch((e: unknown) => e)

    // Assert
    expect(unauthorized).toBe(1)
    expect(error).toMatchObject({ status: 401 })
  })

  test('通信の失敗は状態コード 0 の ApiError にする', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    // Act
    const error = await apiGet('/api/x').catch((e: unknown) => e)

    // Assert
    expect(error).toMatchObject({ status: 0 })
    expect((error as Error).message).toContain('通信できませんでした')
  })

  test('中止 (AbortError) はそのまま投げ直す', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError')
    }))

    // Act
    const error = await apiGet('/api/x').catch((e: unknown) => e)

    // Assert
    expect(isAbortError(error)).toBe(true)
  })

  test('本文がある送信だけ JSON の Content-Type を付ける', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: null })))
    vi.stubGlobal('fetch', fetchMock)

    // Act
    await apiSend('POST', '/api/a', { x: 1 })
    await apiSend('POST', '/api/b')

    // Assert
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"x":1}',
    })
    expect(calls[1][1]).toMatchObject({ method: 'POST', headers: undefined, body: undefined })
  })
})
