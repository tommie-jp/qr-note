import { strToU8, zipSync } from 'fflate'
import { beforeEach, expect, test, vi } from 'vitest'

// 振り分け (ZIP か ENEX か) と門番だけを見る。変換そのものは
// lib/zip/importZip.test.ts と lib/enex/importEnex.test.ts が受け持つ
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

const importZip = vi.fn()
const importEnex = vi.fn()

vi.mock('@/lib/zip/importZip', () => ({
  importZip: (bytes: Uint8Array, options: unknown) => importZip(bytes, options),
}))

vi.mock('@/lib/enex/importEnex', () => ({
  importEnex: (xml: string) => importEnex(xml),
}))

const { POST } = await import('./route')

const ENEX = `<?xml version="1.0" encoding="UTF-8"?><en-export></en-export>`

function upload(file: File, fields: Record<string, string> = {}): Request {
  const body = new FormData()
  body.append('file', file)
  for (const [name, value] of Object.entries(fields)) {
    body.append(name, value)
  }
  return new Request('http://localhost/api/import', { method: 'POST', body })
}

function zipFile(name = 'export.zip'): File {
  const zip = zipSync({ 'notes/1042.md': strToU8('本文') })
  return new File([zip], name, { type: 'application/zip' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = 'tommie'
  mocks.demo = false
  importZip.mockResolvedValue({
    imported: [],
    skipped: [],
    conflictSkipped: 0,
    restoredAttachments: 0,
    deferredImageIndex: 0,
  })
  importEnex.mockResolvedValue({
    imported: [],
    skipped: [],
    deferredImageIndex: 0,
    duplicateSkipped: 0,
  })
})

test('未ログインは 401', async () => {
  mocks.user = null
  const response = await POST(upload(zipFile()))
  expect(response.status).toBe(401)
  expect(importZip).not.toHaveBeenCalled()
})

test('デモモードは 403', async () => {
  mocks.demo = true
  const response = await POST(upload(zipFile()))
  expect(response.status).toBe(403)
  expect(importZip).not.toHaveBeenCalled()
})

test('ZIP は ZIP として取り込む', async () => {
  const response = await POST(upload(zipFile()))
  expect(response.status).toBe(200)
  expect(importZip).toHaveBeenCalled()
  expect(importEnex).not.toHaveBeenCalled()
  expect((await response.json()).data.format).toBe('zip')
})

test('ENEX は ENEX として取り込む', async () => {
  const response = await POST(upload(new File([ENEX], 'notes.enex')))
  expect(response.status).toBe(200)
  expect(importEnex).toHaveBeenCalled()
  expect(importZip).not.toHaveBeenCalled()
  expect((await response.json()).data.format).toBe('enex')
})

// 拡張子は利用者が付け替えられるうえ、共有アプリ経由だと落ちていることもある。
// 中身の先頭で決めるので、名前が違っても取り違えない
test('拡張子ではなく中身の先頭で振り分ける', async () => {
  await POST(upload(zipFile('notes.enex')))
  expect(importZip).toHaveBeenCalled()
  expect(importEnex).not.toHaveBeenCalled()
})

// 戻す操作で手元の編集を黙って潰さない (docs/28 §5)
test('上書きは送られてきたときだけ有効になる', async () => {
  await POST(upload(zipFile()))
  expect(importZip).toHaveBeenCalledWith(expect.anything(), { overwrite: false })

  await POST(upload(zipFile(), { overwrite: '1' }))
  expect(importZip).toHaveBeenLastCalledWith(expect.anything(), { overwrite: true })
})

test('file が無ければ 400', async () => {
  const request = new Request('http://localhost/api/import', {
    method: 'POST',
    body: new FormData(),
  })
  expect((await POST(request)).status).toBe(400)
})

// ZIP として読めないファイルは 1 枚まるごと対象外。理由をそのまま返す
test('ZIP の展開に失敗したら 400 で理由を返す', async () => {
  importZip.mockRejectedValue(new Error('ZIP ファイルではありません'))
  const response = await POST(upload(zipFile()))
  expect(response.status).toBe(400)
  expect((await response.json()).error).toBe('ZIP ファイルではありません')
})
