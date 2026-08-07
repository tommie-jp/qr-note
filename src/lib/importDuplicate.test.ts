import { beforeEach, expect, test, vi } from 'vitest'

// 判定そのもの (SQL に何を渡すか・いつ撃たないか) を見る。
// 呼ぶ側の振る舞いは lib/enex/importEnex.test.ts と lib/zip/importZip.test.ts
const queryRaw = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}))

const { isAlreadyImported } = await import('./importDuplicate')

const CREATED = new Date('2024-01-15T09:30:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  queryRaw.mockResolvedValue([])
})

test('同じ日時・同じ題名の行があれば取り込み済み', async () => {
  queryRaw.mockResolvedValue([{ one: 1 }])
  expect(await isAlreadyImported(CREATED, 'うどん')).toBe(true)
})

test('行が無ければ取り込み済みではない', async () => {
  expect(await isAlreadyImported(CREATED, 'うどん')).toBe(false)
})

test('照合には日時と題名をそのまま渡す', async () => {
  await isAlreadyImported(CREATED, 'うどん')
  const [, created, title] = queryRaw.mock.calls[0]
  expect(created).toBe(CREATED)
  expect(title).toBe('うどん')
})

// 照合の鍵が題名だけになり、同名の別ノート (「メモ」「無題」) を取り違える。
// **問い合わせ自体を撃たない**のが要点 (常に新規として入る)
test('日時が無ければ判定しない', async () => {
  expect(await isAlreadyImported(null, 'うどん')).toBe(false)
  expect(queryRaw).not.toHaveBeenCalled()
})

test('題名が無ければ判定しない', async () => {
  expect(await isAlreadyImported(CREATED, '')).toBe(false)
  expect(queryRaw).not.toHaveBeenCalled()
})
