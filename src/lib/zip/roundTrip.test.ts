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
const newItemId = vi.fn()
const setItemPublic = vi.fn()
const applyImportedTimestamps = vi.fn()
const restoreAttachment = vi.fn()
const executeRaw = vi.fn()
const queryRaw = vi.fn()
const findItemIdsByLegacyNo = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    // 重複判定 (importDuplicate) が使う。ここは本物を通す
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
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

vi.mock('@/lib/items/itemId', () => ({
  newItemId: () => newItemId(),
}))

// 書き出した ZIP は id で戻るので、旧番号の探し方は通らないはず (下で確かめる)
vi.mock('@/lib/items/resolve', () => ({
  findItemIdsByLegacyNo: (itemNo: string, options?: unknown) =>
    findItemIdsByLegacyNo(itemNo, options),
}))

vi.mock('@/lib/items/write', () => ({
  upsertItem: (itemId: string, data: unknown) => upsertItem(itemId, data),
  applyImportedTimestamps: (itemId: string, created: Date | null, updated: Date | null) =>
    applyImportedTimestamps(itemId, created, updated),
}))

vi.mock('@/lib/items/flags', () => ({
  setItemPublic: (itemId: string, isPublic: boolean) => setItemPublic(itemId, isPublic),
}))

vi.mock('@/lib/attachments/restore', () => ({
  restoreAttachment: (name: string, bytes: Uint8Array) => restoreAttachment(name, bytes),
}))

const { exportEntries } = await import('./exportZip')
const { createZipStream } = await import('./zipStream')
const { importZip } = await import('./importZip')

const UUID = '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

// ノートの仮 id。末尾 12 桁に元の番号を入れて読みやすくする
function id(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`
}

// renumber で振られる id
const NEW_ID = id(20001)

async function exportToZip(itemIds: string[] | null): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const stream = createZipStream(exportEntries(itemIds))
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
async function importFrom(itemIds: string[] | null, options = {}) {
  return importZip(chunkedBytes(await exportToZip(itemIds)), options)
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
  queryRaw.mockResolvedValue([]) // 既定は「同内容のノートはいない」
  newItemId.mockReturnValue(NEW_ID)
  findItemIdsByLegacyNo.mockResolvedValue([])
  restoreAttachment.mockResolvedValue({ ok: true, created: true })
})

test('本文・URL・モード・公開状態が往復して元に戻る', async () => {
  findManyItem.mockResolvedValue([
    {
      itemId: id(1042),
      memo: 'hFE=208\n2SC1815 のストック #トランジスタ\n```\ncode "quoted"\n```',
      url: 'https://example.com/?q="a b"&x=1',
      mode: 'url',
      createdAt: new Date('2025-11-02T01:30:00.000Z'),
      updatedAt: new Date('2026-07-01T08:12:00.000Z'),
      publicAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ])

  await importFrom([id(1042)])

  expect(upsertItem).toHaveBeenCalledWith(id(1042), {
    memo: 'hFE=208\n2SC1815 のストック #トランジスタ\n```\ncode "quoted"\n```',
    url: 'https://example.com/?q="a b"&x=1',
    mode: 'url',
  })
  expect(setItemPublic).toHaveBeenCalledWith(id(1042), true)
  // id で書き出したので id の行と突き合わせる。旧番号のタグ検索は通らない
  expect(findUniqueItem).toHaveBeenCalledWith(
    expect.objectContaining({ where: { itemId: id(1042) } }),
  )
  expect(findItemIdsByLegacyNo).not.toHaveBeenCalled()
})

test('本文の画像参照が往復して元の配信 URL に戻る', async () => {
  findManyItem.mockResolvedValue([
    {
      itemId: id(7),
      memo: `写真\n![](/api/images/${UUID}.jpg)`,
      url: '',
      mode: 'memo',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      publicAt: null,
    },
  ])

  await importFrom([id(7)])

  expect(upsertItem).toHaveBeenCalledWith(id(7), {
    memo: `写真\n![](/api/images/${UUID}.jpg)`,
    url: '',
    mode: 'memo',
  })
})

test('添付のバイト列が元の名前のまま往復する', async () => {
  findManyItem.mockResolvedValue([
    {
      itemId: id(7),
      memo: `![](/api/images/${UUID}.jpg)`,
      url: '',
      mode: 'memo',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      publicAt: null,
    },
  ])

  await importFrom([id(7)])

  expect(restoreAttachment).toHaveBeenCalledTimes(1)
  const [name, bytes] = restoreAttachment.mock.calls[0]
  expect(name).toBe(`${UUID}.jpg`)
  expect([...(bytes as Uint8Array)]).toEqual([...JPEG])
})

// 改行で終わる memo と終わらない memo を同じ形で往復させる (noteFile.ts)
test('末尾が改行の本文も往復して元に戻る', async () => {
  findManyItem.mockResolvedValue([
    {
      itemId: id(7),
      memo: '本文\n',
      url: '',
      mode: 'memo',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      publicAt: null,
    },
  ])

  await importFrom([id(7)])

  expect(upsertItem).toHaveBeenCalledWith(id(7), {
    memo: '本文\n',
    url: '',
    mode: 'memo',
  })
})

// --- 新しい id で取り込む (§5) ---

// renumber の要件は「別のインスタンスのノートを手元を壊さず取り込む」。
// 書き出した本物の ZIP を、同じ id が既にある手元へ流す形で確かめる
const ONE_NOTE = [
  {
    itemId: id(1042),
    memo: '題名\n本文',
    url: '',
    mode: 'memo' as const,
    createdAt: new Date('2025-11-02T01:30:00.000Z'),
    updatedAt: new Date('2026-07-01T08:12:00.000Z'),
    publicAt: null,
  },
]

test('renumber は衝突したノートを新しい id で入れる', async () => {
  findManyItem.mockResolvedValue(ONE_NOTE)
  findUniqueItem.mockResolvedValue({ itemId: id(1042) }) // 手元に同じ id がある

  const report = await importFrom([id(1042)], { conflict: 'renumber' })

  expect(report.imported).toEqual([
    { itemId: NEW_ID, title: '題名', renumberedFrom: id(1042) },
  ])
  expect(upsertItem).toHaveBeenCalledWith(NEW_ID, {
    memo: '題名\n本文',
    url: '',
    mode: 'memo',
  })
})

// 素朴に作ると、同じ ZIP を 2 回流した時点で全ノートが複製される
test('renumber で同じ ZIP を流し直しても増えない', async () => {
  findManyItem.mockResolvedValue(ONE_NOTE)
  findUniqueItem.mockResolvedValue({ itemId: id(1042) })
  queryRaw.mockResolvedValue([{ one: 1 }]) // 同内容のノートが既にいる

  const report = await importFrom([id(1042)], { conflict: 'renumber' })

  expect(report.duplicateSkipped).toBe(1)
  expect(report.imported).toEqual([])
  expect(newItemId).not.toHaveBeenCalled()
  expect(upsertItem).not.toHaveBeenCalled()
})

test('複数ノートと共有の添付をまとめて往復できる', async () => {
  const memo = `共有\n![](/api/images/${UUID}.jpg)`
  findManyItem
    .mockResolvedValueOnce([{ itemId: id(1) }, { itemId: id(2) }])
    .mockResolvedValueOnce([
      {
        itemId: id(1),
        memo,
        url: '',
        mode: 'memo',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        publicAt: null,
      },
      {
        itemId: id(2),
        memo,
        url: '',
        mode: 'memo',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        publicAt: null,
      },
    ])

  const report = await importFrom(null)

  expect(report.imported.map((note) => note.itemId)).toEqual([id(1), id(2)])
  // 同じ添付は 1 回だけ入る
  expect(restoreAttachment).toHaveBeenCalledTimes(1)
  expect(report.skipped).toEqual([])
})
