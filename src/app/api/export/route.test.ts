import { beforeEach, expect, test, vi } from 'vitest'
import type { ZipEntry } from '@/lib/zip/zipStream'

// 門番 (ログイン・デモ・クロスサイト) の判定そのものは本物を通し、
// その材料だけを差し替える。DB は触らない
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

const exportEntries = vi.fn()
vi.mock('@/lib/zip/exportZip', () => ({
  exportEntries: (itemNos: string[] | null) => exportEntries(itemNos),
}))

const { POST } = await import('./route')

async function* noEntries(): AsyncGenerator<ZipEntry> {}

function postRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/export', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = 'tommie'
  mocks.demo = false
  exportEntries.mockImplementation(() => noEntries())
})

test('未ログインは 401', async () => {
  mocks.user = null
  const response = await POST(postRequest('scope=all'))
  expect(response.status).toBe(401)
  expect(exportEntries).not.toHaveBeenCalled()
})

// 共有アカウントのデモに「全データを 1 ファイルで持ち出す口」は開けない
test('デモモードは 403 (ログイン済みでも)', async () => {
  mocks.demo = true
  const response = await POST(postRequest('scope=all'))
  expect(response.status).toBe(403)
  expect(exportEntries).not.toHaveBeenCalled()
})

test('第三者のページからの呼び出しは 403', async () => {
  const response = await POST(
    postRequest('scope=all', { 'sec-fetch-site': 'cross-site' }),
  )
  expect(response.status).toBe(403)
  expect(exportEntries).not.toHaveBeenCalled()
})

// 選択の受け渡しが壊れたときに黙って全件を書き出さない
test('scope が無ければ 400 (全件に倒さない)', async () => {
  const response = await POST(postRequest('itemNo=1042'))
  expect(response.status).toBe(400)
  expect(exportEntries).not.toHaveBeenCalled()
})

test('scope=selected で 1 件も選ばれていなければ 400', async () => {
  const response = await POST(postRequest('scope=selected'))
  expect(response.status).toBe(400)
  expect(exportEntries).not.toHaveBeenCalled()
})

test('scope=all は全件 (null) を対象にする', async () => {
  const response = await POST(postRequest('scope=all'))
  expect(response.status).toBe(200)
  expect(exportEntries).toHaveBeenCalledWith(null)
})

test('scope=selected は選んだ番号だけを対象にする', async () => {
  await POST(postRequest('scope=selected&itemNo=1042&itemNo=7'))
  expect(exportEntries).toHaveBeenCalledWith(['1042', '7'])
})

// 書式外の番号は parseSelectedItemNos が落とす。全部落ちたら 400
test('書式外の番号は落とす', async () => {
  await POST(postRequest('scope=selected&itemNo=1042&itemNo=..%2Fetc'))
  expect(exportEntries).toHaveBeenCalledWith(['1042'])
})

test('ZIP としてダウンロードさせる見出しを付ける', async () => {
  const response = await POST(postRequest('scope=all'))
  expect(response.headers.get('content-type')).toBe('application/zip')
  expect(response.headers.get('content-disposition')).toMatch(
    /^attachment; filename="qr-note-export-\d{4}-\d{2}-\d{2}\.zip"$/,
  )
  // ノート本文そのもの。共有キャッシュにも履歴にも残させない
  expect(response.headers.get('cache-control')).toBe('no-store')
})

test('中身は ZIP のバイト列', async () => {
  const response = await POST(postRequest('scope=all'))
  const bytes = new Uint8Array(await response.arrayBuffer())
  // 空の ZIP は中央ディレクトリ終端レコードだけ ("PK\x05\x06")
  expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b])
})
