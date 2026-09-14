import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { externalLookup, type ExternalLookupSpec } from './lookup'

// 外部照会の口の骨格 (docs/93-リファクタリング計画.md §3-3)。
// 実際の 2 つの口 (books / products) は src/app/api/lookup.test.ts が試す。
// ここは骨格の順 (門番 → デモ → 検算 → 照会) と応答の形を見る
const mocks = vi.hoisted(() => ({
  user: 'tommie' as string | null,
}))

vi.mock('@/lib/auth/session', () => ({
  currentUser: async () => mocks.user,
}))

const lookup = vi.fn()

const SPEC: ExternalLookupSpec<'code'> = {
  param: 'code',
  isValidCode: (code) => /^\d{3}$/.test(code),
  invalidCodeMessage: 'コードではありません',
  lookup: (code) => lookup(code),
  failureMessage: '照会に失敗しました',
}

function call(code: string, spec: ExternalLookupSpec<'code'> = SPEC, site = 'same-origin') {
  return externalLookup(
    new Request(`http://localhost/api/x/${code}`, { headers: { 'sec-fetch-site': site } }),
    Promise.resolve({ code }),
    spec,
  )
}

async function contractOf(response: Response) {
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: await response.json(),
  }
}

beforeEach(() => {
  mocks.user = 'tommie'
  lookup.mockReset().mockResolvedValue({ title: '本' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('門番とデモ', () => {
  test('未ログインは照会せずに 401', async () => {
    mocks.user = null

    const res = await call('123')

    expect(res.status).toBe(401)
    expect(lookup).not.toHaveBeenCalled()
  })

  test('クロスサイトは照会せずに 403', async () => {
    const res = await call('123', SPEC, 'cross-site')

    expect(res.status).toBe(403)
    expect(lookup).not.toHaveBeenCalled()
  })

  test('demoDisabledMessage があれば、デモでは検算より前に demoDisabled を返す', async () => {
    vi.stubEnv('DEMO_MODE', '1')

    const res = await call('not-a-code', { ...SPEC, demoDisabledMessage: 'デモでは使えません' })

    expect(await contractOf(res)).toEqual({
      status: 200,
      cacheControl: null,
      body: { success: false, data: null, error: 'デモでは使えません', demoDisabled: true },
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  test('demoDisabledMessage が無ければデモでも照会する', async () => {
    vi.stubEnv('DEMO_MODE', '1')

    expect((await call('123')).status).toBe(200)
    expect(lookup).toHaveBeenCalledWith('123')
  })
})

describe('照会', () => {
  test('検算に通らなければ 400 (Cache-Control なし)', async () => {
    expect(await contractOf(await call('12a'))).toEqual({
      status: 400,
      cacheControl: null,
      body: { success: false, data: null, error: 'コードではありません' },
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  test('結果を data に包んで返す (Cache-Control なし)', async () => {
    expect(await contractOf(await call('123'))).toEqual({
      status: 200,
      cacheControl: null,
      body: { success: true, data: { title: '本' }, error: null },
    })
  })

  test('見つからない (null) はエラーにしない', async () => {
    lookup.mockResolvedValue(null)

    expect((await contractOf(await call('123'))).body).toEqual({
      success: true,
      data: null,
      error: null,
    })
  })

  test('照会が投げたら 502 で、原因はログにだけ残す', async () => {
    lookup.mockRejectedValue(new Error('upstream secret detail'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await contractOf(await call('123'))).toEqual({
      status: 502,
      cacheControl: null,
      body: { success: false, data: null, error: '照会に失敗しました' },
    })
    expect(consoleError).toHaveBeenCalledWith('照会に失敗しました', expect.any(Error))
  })
})
