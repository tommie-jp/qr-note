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
const { currentImport, releaseImport, beginImport } = await import(
  '@/lib/zip/importProgressStore'
)

const ENEX = `<?xml version="1.0" encoding="UTF-8"?><en-export></en-export>`

// 本文はファイルそのもの (multipart ではない)。500MB を受けるために、
// ブラウザからも同じ形で送る
function upload(body: BodyInit, query = ''): Request {
  return new Request(`http://localhost/api/import${query}`, {
    method: 'POST',
    body,
  })
}

function zipBody(): Uint8Array<ArrayBuffer> {
  return zipSync({ 'notes/1042.md': strToU8('本文') }) as Uint8Array<ArrayBuffer>
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
  releaseImport()
})

// --- 進捗 (docs/28 §9) ---

// importZip は同時実行を想定していない (採番・衝突判定が競合する)。
// 進捗のスロット以前に必要な門
test('取り込み中に重ねて呼ばれたら 409', async () => {
  beginImport(1000)
  const response = await POST(upload(zipBody()))
  expect(response.status).toBe(409)
  expect(importZip).not.toHaveBeenCalled()
})

test('取り込みが終わればスロットは空く (次が始められる)', async () => {
  await POST(upload(zipBody()))
  expect(currentImport()).toBeNull()
})

// 失敗して抜けたときに握ったままだと、次の取り込みが始められなくなる
test('失敗してもスロットは空く', async () => {
  importZip.mockRejectedValue(new Error('壊れています'))
  await POST(upload(zipBody()))
  expect(currentImport()).toBeNull()
})

// 読んだバイト数がそのまま進捗になる。取り込みの最中に覗けること
test('本文を読みながら進捗を積み上げる', async () => {
  const seen: Array<number | null> = []
  importZip.mockImplementation(async (source: AsyncIterable<Uint8Array>) => {
    for await (const _chunk of source) {
      seen.push(currentImport()?.readBytes ?? null)
    }
    return {
      imported: [],
      skipped: [],
      conflictSkipped: 0,
      restoredAttachments: 0,
      deferredImageIndex: 0,
    }
  })

  await POST(upload(zipBody()))

  expect(seen.length).toBeGreaterThan(0)
  expect(seen.at(-1)).toBe(zipBody().byteLength)
})

// Content-Length が % の分母になる。ブラウザは File を本文にすると必ず
// 名乗る (大きさが判っているため)。Node の Request は組み立て時に付けないので、
// ここでは明示して本物の要求に寄せる
test('名乗られた大きさを進捗の分母にする', async () => {
  let total: number | null | undefined
  importZip.mockImplementation(async (source: AsyncIterable<Uint8Array>) => {
    for await (const _chunk of source) {
      total = currentImport()?.totalBytes
    }
    return {
      imported: [],
      skipped: [],
      conflictSkipped: 0,
      restoredAttachments: 0,
      deferredImageIndex: 0,
    }
  })

  const request = new Request('http://localhost/api/import', {
    method: 'POST',
    body: zipBody(),
    headers: { 'content-length': String(zipBody().byteLength) },
  })
  await POST(request)

  expect(total).toBe(zipBody().byteLength)
})

// 名乗らない相手 (chunked) では割合を出しようがない。出鱈目な数字より「不明」
test('名乗りが無ければ分母は null (% を出さない)', async () => {
  let total: number | null | undefined
  importZip.mockImplementation(async (source: AsyncIterable<Uint8Array>) => {
    for await (const _chunk of source) {
      total = currentImport()?.totalBytes
    }
    return {
      imported: [],
      skipped: [],
      conflictSkipped: 0,
      restoredAttachments: 0,
      deferredImageIndex: 0,
    }
  })

  await POST(upload(zipBody()))

  expect(total).toBeNull()
})

test('未ログインは 401', async () => {
  mocks.user = null
  const response = await POST(upload(zipBody()))
  expect(response.status).toBe(401)
  expect(importZip).not.toHaveBeenCalled()
})

test('デモモードは 403', async () => {
  mocks.demo = true
  const response = await POST(upload(zipBody()))
  expect(response.status).toBe(403)
  expect(importZip).not.toHaveBeenCalled()
})

test('ZIP は ZIP として取り込む', async () => {
  const response = await POST(upload(zipBody()))
  expect(response.status).toBe(200)
  expect(importZip).toHaveBeenCalled()
  expect(importEnex).not.toHaveBeenCalled()
  expect((await response.json()).data.format).toBe('zip')
})

test('ENEX は ENEX として取り込む', async () => {
  const response = await POST(upload(ENEX))
  expect(response.status).toBe(200)
  expect(importEnex).toHaveBeenCalled()
  expect(importZip).not.toHaveBeenCalled()
  expect((await response.json()).data.format).toBe('enex')
})

// 名前も Content-Type も利用者が付け替えられる。中身の先頭で決めるので、
// ENEX を名乗る ZIP でも取り違えない
test('名乗りではなく中身の先頭で振り分ける', async () => {
  const request = new Request('http://localhost/api/import', {
    method: 'POST',
    body: zipBody(),
    headers: { 'content-type': 'application/xml' },
  })
  await POST(request)
  expect(importZip).toHaveBeenCalled()
  expect(importEnex).not.toHaveBeenCalled()
})

// 戻す操作で手元の編集を黙って潰さない (docs/28 §5)
test('上書きはクエリで明示されたときだけ有効になる', async () => {
  await POST(upload(zipBody()))
  expect(importZip).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ overwrite: false }),
  )

  await POST(upload(zipBody(), '?overwrite=1'))
  expect(importZip).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ overwrite: true }),
  )
})

test('本文が無ければ 400', async () => {
  const request = new Request('http://localhost/api/import', { method: 'POST' })
  expect((await POST(request)).status).toBe(400)
})

// Content-Length は名乗りでしかないが、名乗った時点で明らかに大きいものは
// 本文を読む前に断る
test('名乗りが上限を超えていたら本文を読む前に 413', async () => {
  const { MAX_ZIP_BYTES } = await import('@/lib/zip/limits')
  const request = new Request('http://localhost/api/import', {
    method: 'POST',
    body: zipBody(),
    headers: { 'content-length': String(MAX_ZIP_BYTES + 1) },
  })
  expect((await POST(request)).status).toBe(413)
  expect(importZip).not.toHaveBeenCalled()
})

// ZIP として読めないファイルは 1 枚まるごと対象外。理由をそのまま返す
test('ZIP の展開に失敗したら 400 で理由を返す', async () => {
  importZip.mockRejectedValue(new Error('ZIP ファイルではありません'))
  const response = await POST(upload(zipBody()))
  expect(response.status).toBe(400)
  expect((await response.json()).error).toBe('ZIP ファイルではありません')
})
