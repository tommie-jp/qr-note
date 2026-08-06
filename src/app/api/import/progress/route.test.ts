import { beforeEach, expect, test, vi } from 'vitest'

// 門番の判定そのものは本物を通し、その材料だけを差し替える
const mocks = vi.hoisted(() => ({
  user: 'tommie' as string | null,
  demo: false,
}))

vi.mock('@/lib/session', () => ({
  currentUser: async () => mocks.user,
}))

vi.mock('@/lib/appEnv', () => ({
  isDemoMode: () => mocks.demo,
}))

const { GET } = await import('./route')
const { beginImport, releaseImport } = await import('@/lib/zip/importProgressStore')

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/import/progress', {
    headers: { 'sec-fetch-site': 'same-origin', ...headers },
  })
}

beforeEach(() => {
  mocks.user = 'tommie'
  mocks.demo = false
  releaseImport()
})

test('未ログインは 401', async () => {
  mocks.user = null
  expect((await GET(request())).status).toBe(401)
})

test('デモモードは 403', async () => {
  mocks.demo = true
  expect((await GET(request())).status).toBe(403)
})

test('第三者のページからの呼び出しは 403', async () => {
  const response = await GET(request({ 'sec-fetch-site': 'cross-site' }))
  expect(response.status).toBe(403)
})

test('取り込んでいなければ data は null', async () => {
  const response = await GET(request())
  expect(await response.json()).toEqual({ success: true, data: null, error: null })
})

test('取り込み中は進み具合を返す', async () => {
  const handle = beginImport(1000)
  handle.addBytes(250)

  const body = await (await GET(request())).json()

  expect(body.data).toMatchObject({
    phase: 'receiving',
    totalBytes: 1000,
    readBytes: 250,
  })
})

// 進み具合は一瞬で古くなる。中継にもブラウザにも溜めさせない
test('キャッシュさせない', async () => {
  const response = await GET(request())
  expect(response.headers.get('cache-control')).toBe('no-store')
})
