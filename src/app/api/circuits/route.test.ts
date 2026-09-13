import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CircuitRenderError } from '@/lib/circuit/renderError'
import { MAX_TEXT_LENGTH } from '@/lib/validation'
import {
  failEnvelope,
  jsonContract,
  okEnvelope,
  responseContract,
} from '@/test/routeResponse'

// 編集画面のライブプレビューが回路図を描かせる口 (docs/70-編集ライブプレビュー計画.md §7)。
// 描画 (circuitCache / circuitYaml) は差し替え、門番・本文の検算・結果の包み方を見る。
// 描画そのものは lib 側のテストが受け持つ
const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  validToken: 'valid-session-token',
  renderTikz: vi.fn(),
  renderYaml: vi.fn(),
}))

vi.mock('next/headers', async () => {
  const { SESSION_COOKIE_NAME } = await import('@/lib/sessionToken')
  return {
    headers: async () => new Headers(),
    cookies: async () => ({
      get: (name: string) =>
        name === SESSION_COOKIE_NAME && mocks.sessionToken !== null
          ? { name, value: mocks.sessionToken }
          : undefined,
    }),
  }
})

vi.mock('@/lib/sessionStore', () => ({
  findActiveSession: async (token: string) =>
    token === mocks.validToken
      ? { userName: 'tommie', expiresAt: new Date('2099-01-01T00:00:00.000Z') }
      : null,
}))

vi.mock('@/lib/circuitCache', () => ({
  getOrRenderCircuit: (source: string) => mocks.renderTikz(source),
}))

vi.mock('@/lib/circuitYaml', () => ({
  renderCircuitYaml: (source: string) => mocks.renderYaml(source),
}))

const { POST } = await import('./route')

function circuitRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/circuits', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const NO_SOURCE = failEnvelope('回路図のソースがありません')

beforeEach(() => {
  mocks.sessionToken = mocks.validToken
  mocks.renderTikz.mockReset().mockResolvedValue('<svg>tikz</svg>')
  mocks.renderYaml.mockReset().mockResolvedValue({ svg: '<svg>yaml</svg>', notices: [] })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('拒否系 (描く前に弾く)', () => {
  test('未ログインはクロスサイト判定より先に 401', async () => {
    mocks.sessionToken = null

    const res = await POST(circuitRequest({ source: 'x' }, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(401, failEnvelope('ログインが必要です')),
    )
    expect(mocks.renderTikz).not.toHaveBeenCalled()
  })

  test('クロスサイトは 403', async () => {
    const res = await POST(circuitRequest({ source: 'x' }, { 'sec-fetch-site': 'cross-site' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(403, failEnvelope('クロスサイトからの呼び出しは許可されていません')),
    )
    expect(mocks.renderTikz).not.toHaveBeenCalled()
  })

  test('JSON にならない本文は 400 (ソースが無い扱い)', async () => {
    const res = await POST(circuitRequest('{'))

    expect(await responseContract(res)).toEqual(jsonContract(400, NO_SOURCE))
  })

  test('空白だけのソースは 400', async () => {
    const res = await POST(circuitRequest({ source: '  \n ' }))

    expect(await responseContract(res)).toEqual(jsonContract(400, NO_SOURCE))
  })

  test('文字列でないソースは 400', async () => {
    const res = await POST(circuitRequest({ source: 42 }))

    expect(await responseContract(res)).toEqual(jsonContract(400, NO_SOURCE))
  })

  test('本文の上限より長いソースは 413', async () => {
    const res = await POST(circuitRequest({ source: 'a'.repeat(MAX_TEXT_LENGTH + 1) }))

    expect(await responseContract(res)).toEqual(
      jsonContract(413, failEnvelope('回路図のソースが長すぎます')),
    )
  })

  test('知らないフェンス言語は 400', async () => {
    const res = await POST(circuitRequest({ source: 'x', lang: 'mermaid' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(400, failEnvelope('知らないフェンス言語です')),
    )
  })
})

describe('描画', () => {
  // 回路図は本文の一部で、閲覧ではデモでも描かれている
  test('デモでも断らない', async () => {
    vi.stubEnv('DEMO_MODE', '1')

    const res = await POST(circuitRequest({ source: 'x' }))

    expect(res.status).toBe(200)
  })

  test('言語の省略は circuitikz として、trim したソースで描く', async () => {
    const res = await POST(
      circuitRequest({ source: '  \\draw (0,0);\n' }, { 'sec-fetch-site': 'same-origin' }),
    )

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ svg: '<svg>tikz</svg>' })),
    )
    expect(mocks.renderTikz).toHaveBeenCalledWith('\\draw (0,0);')
  })

  test('circuit (YAML) は結果をそのまま包んで返す', async () => {
    const res = await POST(circuitRequest({ source: ' parts: []\n', lang: 'circuit' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ svg: '<svg>yaml</svg>', notices: [] })),
    )
    expect(mocks.renderYaml).toHaveBeenCalledWith('parts: []')
    expect(mocks.renderTikz).not.toHaveBeenCalled()
  })

  // 書き間違いは普通のことなので 5xx にしない
  test('描画エラーは 200 で理由 (TeX のログ) を返す', async () => {
    mocks.renderTikz.mockRejectedValue(new CircuitRenderError('描けません', '! Undefined'))

    const res = await POST(circuitRequest({ source: 'x' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(200, okEnvelope({ error: '描けません', texLog: '! Undefined' })),
    )
  })

  test('想定外の失敗は 500', async () => {
    mocks.renderTikz.mockRejectedValue(new Error('spawn failed'))

    const res = await POST(circuitRequest({ source: 'x' }))

    expect(await responseContract(res)).toEqual(
      jsonContract(500, failEnvelope('回路図を描画できませんでした')),
    )
  })
})
