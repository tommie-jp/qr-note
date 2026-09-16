import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseFormBody, parseJsonBody, readJsonObject } from './parse'

// 本文の読み取り (docs/93-リファクタリング計画.md §3-3)。

function jsonRequest(body: string): Request {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

async function contractOf(response: Response) {
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: await response.text(),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readJsonObject', () => {
  test('オブジェクトならそのまま返す', async () => {
    expect(await readJsonObject(jsonRequest('{"query":"抵抗"}'))).toEqual({ query: '抵抗' })
  })

  test('壊れた JSON は null', async () => {
    expect(await readJsonObject(jsonRequest('{'))).toBeNull()
  })

  // JSON.parse は通してしまう値
  test('null・数・配列は null', async () => {
    for (const body of ['null', '42', '["a"]']) {
      expect(await readJsonObject(jsonRequest(body)), body).toBeNull()
    }
  })
})

describe('parseJsonBody', () => {
  const queryOf = (body: Readonly<Record<string, unknown>>) =>
    typeof body.query === 'string' ? body.query : null

  test('check が取り出した値を返す', async () => {
    // Act
    const parsed = await parseJsonBody(jsonRequest('{"query":"抵抗"}'), queryOf)

    // Assert
    expect(parsed).toEqual({ ok: true, value: '抵抗' })
  })

  test('check が null を返したら 400 の封筒 (no-store)', async () => {
    const parsed = await parseJsonBody(jsonRequest('{"query":7}'), queryOf)

    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? null : await contractOf(parsed.response)).toEqual({
      status: 400,
      cacheControl: 'no-store',
      body: '{"success":false,"data":null,"error":"リクエストの形式が正しくありません"}',
    })
  })

  test('JSON として読めなければ check を呼ばずに 400', async () => {
    const check = vi.fn(queryOf)

    const parsed = await parseJsonBody(jsonRequest('{'), check)

    expect(parsed.ok).toBe(false)
    expect(check).not.toHaveBeenCalled()
  })
})

describe('parseFormBody', () => {
  const failure = { log: '解析に失敗しました:', message: 'フォームの形式が正しくありません' }

  test('FormData を返す', async () => {
    const request = new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'scope=all',
    })

    const parsed = await parseFormBody(request, failure)

    expect(parsed.ok && parsed.value.get('scope')).toBe('all')
  })

  test('読めなければ原因をログに残して 400 (応答の見出しは呼び手が決める)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const request = new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=zz' },
      body: 'broken',
    })

    const parsed = await parseFormBody(request, failure, { cacheControl: 'private, max-age=60' })

    expect(parsed.ok ? null : await contractOf(parsed.response)).toEqual({
      status: 400,
      cacheControl: 'private, max-age=60',
      body: '{"success":false,"data":null,"error":"フォームの形式が正しくありません"}',
    })
    expect(consoleError).toHaveBeenCalledWith('解析に失敗しました:', expect.any(Error))
  })
})
