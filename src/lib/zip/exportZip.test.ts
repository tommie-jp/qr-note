import { beforeEach, expect, test, vi } from 'vitest'
import type { ZipEntry } from './zipStream'

// DB は差し替える。確かめたいのは「何を・どの順で・何回引くか」であって
// Postgres ではない (ENEX のテストと同じ流儀)
const findManyItem = vi.fn()
const findUniqueImage = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    item: { findMany: (args: unknown) => findManyItem(args) },
    image: { findUnique: (args: unknown) => findUniqueImage(args) },
  },
}))

const { exportEntries } = await import('./exportZip')

const UUID = '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6'

function row(itemNo: string, memo = '本文') {
  return {
    itemNo,
    memo,
    url: '',
    mode: 'memo' as const,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
    publicAt: null,
  }
}

const EXPORTED_AT = new Date('2026-08-07T05:00:00.000Z')

async function collectAll(itemNos: string[] | null): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = []
  for await (const entry of exportEntries(itemNos, EXPORTED_AT)) {
    entries.push(entry)
  }
  return entries
}

// 覚え書き (export.json) は必ず先頭に入る。ここから下の関心は notes/ と
// images/ の並びなので外して返し、覚え書き自体は専用のテストで確かめる
async function collect(itemNos: string[] | null): Promise<ZipEntry[]> {
  const entries = await collectAll(itemNos)
  return entries.filter((entry) => entry.path !== 'export.json')
}

function decode(entry: ZipEntry): string {
  return new TextDecoder().decode(entry.data)
}

beforeEach(() => {
  vi.clearAllMocks()
  findUniqueImage.mockResolvedValue({ data: new Uint8Array([1, 2, 3]) })
})

// 覚え書き (docs/28 §1)。手元に残った ZIP だけで「どの版がいつ書き出したか」
// が判るようにする
test('先頭に export.json を入れる', async () => {
  findManyItem.mockResolvedValue([row('1042')])

  const entries = await collectAll(['1042'])

  expect(entries[0].path).toBe('export.json')
  expect(JSON.parse(decode(entries[0]))).toMatchObject({
    format: 'qr-note-export',
    formatVersion: 1,
    exportedAt: '2026-08-07T05:00:00.000Z',
    noteCount: 1,
  })
  // 版はアプリのものをそのまま載せる (調査で頼りにするのはここ)
  expect(JSON.parse(decode(entries[0])).appVersion).toMatch(/^\d+\.\d+\.\d+/)
})

test('選択した番号のノートを notes/ に入れる', async () => {
  findManyItem.mockResolvedValue([row('1042')])

  const entries = await collect(['1042'])

  expect(entries).toHaveLength(1)
  expect(entries[0].path).toBe('notes/1042.md')
  expect(decode(entries[0])).toContain('itemNo: "1042"')
  // 手元に展開したとき元の更新順が残る
  expect(entries[0].mtime).toEqual(new Date('2025-02-01T00:00:00.000Z'))
})

test('選んだ順のまま入る', async () => {
  findManyItem.mockResolvedValue([row('7'), row('1042'), row('30')])

  const entries = await collect(['1042', '7', '30'])

  expect(entries.map((entry) => entry.path)).toEqual([
    'notes/1042.md',
    'notes/7.md',
    'notes/30.md',
  ])
})

test('本文が参照する添付を images/ に入れる', async () => {
  findManyItem.mockResolvedValue([row('1042', `![](/api/images/${UUID}.jpg)`)])

  const entries = await collect(['1042'])

  expect(entries.map((entry) => entry.path)).toEqual([
    'notes/1042.md',
    `images/${UUID}.jpg`,
  ])
  // 添付は既に圧縮済みなので素通しで入れる
  expect(entries[1].compress).toBe(false)
})

test('同じ添付を複数のノートが指しても 1 回だけ入れる', async () => {
  const memo = `![](/api/images/${UUID}.jpg)`
  findManyItem.mockResolvedValue([row('1', memo), row('2', memo)])

  const entries = await collect(['1', '2'])

  expect(entries.filter((entry) => entry.path.startsWith('images/'))).toHaveLength(1)
  expect(findUniqueImage).toHaveBeenCalledTimes(1)
})

// 本文の参照はそのまま (../images/) 残す。戻せば元の状態に戻るので、
// 1 枚欠けただけで全件の書き出しを失敗させない
test('参照先の添付が無くても書き出しは続く', async () => {
  findManyItem.mockResolvedValue([row('1042', `![](/api/images/${UUID}.jpg)`)])
  findUniqueImage.mockResolvedValue(null)

  const entries = await collect(['1042'])

  expect(entries.map((entry) => entry.path)).toEqual(['notes/1042.md'])
  expect(decode(entries[0])).toContain(`../images/${UUID}.jpg`)
})

test('存在しない番号は飛ばして残りを書き出す', async () => {
  findManyItem.mockResolvedValue([row('1042')])

  const entries = await collect(['1042', '9999'])

  expect(entries.map((entry) => entry.path)).toEqual(['notes/1042.md'])
})

test('null を渡すと全ノートを対象にする (ゴミ箱は除く)', async () => {
  findManyItem
    .mockResolvedValueOnce([{ itemNo: '1' }, { itemNo: '2' }])
    .mockResolvedValueOnce([row('1'), row('2')])

  const entries = await collect(null)

  expect(entries.map((entry) => entry.path)).toEqual(['notes/1.md', 'notes/2.md'])
  expect(findManyItem.mock.calls[0][0]).toMatchObject({
    where: { deletedAt: null },
  })
})

// 添付は 1 件が数 MB。本文を全部読み終えてから、1 件ずつ引く
test('添付は引かれるまで DB を読まない', async () => {
  findManyItem.mockResolvedValue([row('1042', `![](/api/images/${UUID}.jpg)`)])

  const iterator = exportEntries(['1042'])[Symbol.asyncIterator]()
  await iterator.next()

  expect(findUniqueImage).not.toHaveBeenCalled()
})
