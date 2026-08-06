import { beforeEach, expect, test, vi } from 'vitest'
import { chunkedBytes } from '@/lib/bytes'

// 書き出して取り込むと元に戻ること。**この機能の要件そのもの**なので、
// 層ごとのテストとは別に端から端まで 1 本通す (往復できない書き出しは
// ただのファイル生成であって、エクスポートではない)。
//
// DB だけ差し替えて、ZIP の組み立て・展開・frontmatter の解釈は本物を通す。
const findManyItem = vi.fn()
const findUniqueItem = vi.fn()
const findUniqueImage = vi.fn()
const findManyImage = vi.fn()
const upsertItem = vi.fn()
const setItemPublic = vi.fn()
const applyImportedTimestamps = vi.fn()
const restoreAttachment = vi.fn()
const executeRaw = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    item: {
      findMany: (args: unknown) => findManyItem(args),
      findUnique: (args: unknown) => findUniqueItem(args),
    },
    image: {
      findUnique: (args: unknown) => findUniqueImage(args),
      findMany: (args: unknown) => findManyImage(args),
    },
  },
}))

vi.mock('@/lib/items', () => ({
  upsertItem: (itemNo: string, data: unknown) => upsertItem(itemNo, data),
  setItemPublic: (itemNo: string, isPublic: boolean) => setItemPublic(itemNo, isPublic),
  applyImportedTimestamps: (itemNo: string, created: Date | null, updated: Date | null) =>
    applyImportedTimestamps(itemNo, created, updated),
}))

vi.mock('@/lib/attachmentStore', () => ({
  restoreAttachment: (name: string, bytes: Uint8Array) => restoreAttachment(name, bytes),
}))

const { exportEntries } = await import('./exportZip')
const { createZipStream } = await import('./zipStream')
const { importZip } = await import('./importZip')

const UUID = '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

async function exportToZip(itemNos: string[] | null): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const stream = createZipStream(exportEntries(itemNos))
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

// 取り込みは本文を流し読みする。書き出した ZIP をそのまま流し込む
async function importFrom(itemNos: string[] | null) {
  return importZip(chunkedBytes(await exportToZip(itemNos)))
}

beforeEach(() => {
  vi.clearAllMocks()
  findUniqueItem.mockResolvedValue(null)
  findManyImage.mockResolvedValue([])
  findUniqueImage.mockResolvedValue({ data: JPEG })
  upsertItem.mockResolvedValue(undefined)
  setItemPublic.mockResolvedValue(0)
  applyImportedTimestamps.mockResolvedValue(undefined)
  executeRaw.mockResolvedValue(1)
  restoreAttachment.mockResolvedValue({ ok: true, created: true })
})

test('本文・URL・モード・公開状態が往復して元に戻る', async () => {
  findManyItem.mockResolvedValue([
    {
      itemNo: '1042',
      memo: 'hFE=208\n2SC1815 のストック #トランジスタ\n```\ncode "quoted"\n```',
      url: 'https://example.com/?q="a b"&x=1',
      mode: 'url',
      createdAt: new Date('2025-11-02T01:30:00.000Z'),
      updatedAt: new Date('2026-07-01T08:12:00.000Z'),
      publicAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ])

  await importFrom(['1042'])

  expect(upsertItem).toHaveBeenCalledWith('1042', {
    memo: 'hFE=208\n2SC1815 のストック #トランジスタ\n```\ncode "quoted"\n```',
    url: 'https://example.com/?q="a b"&x=1',
    mode: 'url',
  })
  expect(setItemPublic).toHaveBeenCalledWith('1042', true)
})

test('本文の画像参照が往復して元の配信 URL に戻る', async () => {
  findManyItem.mockResolvedValue([
    {
      itemNo: '7',
      memo: `写真\n![](/api/images/${UUID}.jpg)`,
      url: '',
      mode: 'memo',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      publicAt: null,
    },
  ])

  await importFrom(['7'])

  expect(upsertItem).toHaveBeenCalledWith('7', {
    memo: `写真\n![](/api/images/${UUID}.jpg)`,
    url: '',
    mode: 'memo',
  })
})

test('添付のバイト列が元の名前のまま往復する', async () => {
  findManyItem.mockResolvedValue([
    {
      itemNo: '7',
      memo: `![](/api/images/${UUID}.jpg)`,
      url: '',
      mode: 'memo',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      publicAt: null,
    },
  ])

  await importFrom(['7'])

  expect(restoreAttachment).toHaveBeenCalledTimes(1)
  const [name, bytes] = restoreAttachment.mock.calls[0]
  expect(name).toBe(`${UUID}.jpg`)
  expect([...(bytes as Uint8Array)]).toEqual([...JPEG])
})

// 改行で終わる memo と終わらない memo を同じ形で往復させる (noteFile.ts)
test('末尾が改行の本文も往復して元に戻る', async () => {
  findManyItem.mockResolvedValue([
    {
      itemNo: '7',
      memo: '本文\n',
      url: '',
      mode: 'memo',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      publicAt: null,
    },
  ])

  await importFrom(['7'])

  expect(upsertItem).toHaveBeenCalledWith('7', {
    memo: '本文\n',
    url: '',
    mode: 'memo',
  })
})

test('複数ノートと共有の添付をまとめて往復できる', async () => {
  const memo = `共有\n![](/api/images/${UUID}.jpg)`
  findManyItem
    .mockResolvedValueOnce([{ itemNo: '1' }, { itemNo: '2' }])
    .mockResolvedValueOnce([
      {
        itemNo: '1',
        memo,
        url: '',
        mode: 'memo',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        publicAt: null,
      },
      {
        itemNo: '2',
        memo,
        url: '',
        mode: 'memo',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        publicAt: null,
      },
    ])

  const report = await importFrom(null)

  expect(report.imported.map((note) => note.itemNo)).toEqual(['1', '2'])
  // 同じ添付は 1 回だけ入る
  expect(restoreAttachment).toHaveBeenCalledTimes(1)
  expect(report.skipped).toEqual([])
})
