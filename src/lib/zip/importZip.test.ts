import { strToU8, zipSync } from 'fflate'
import { beforeEach, expect, test, vi } from 'vitest'
import { chunkedBytes } from '@/lib/bytes'

// DB と添付の保存は差し替える。確かめたいのは繋ぎ役の振る舞い —
// 「入らなかったものが必ずレポートに出るか」であって Postgres や sharp ではない
// (lib/enex/importEnex.test.ts と同じ流儀)
const upsertItem = vi.fn()
const setItemPublic = vi.fn()
const applyImportedTimestamps = vi.fn()
const restoreAttachment = vi.fn()
const executeRaw = vi.fn()
const findUniqueItem = vi.fn()
const findManyImage = vi.fn()

vi.mock('@/lib/items', () => ({
  upsertItem: (itemNo: string, data: unknown) => upsertItem(itemNo, data),
  setItemPublic: (itemNo: string, isPublic: boolean) => setItemPublic(itemNo, isPublic),
  applyImportedTimestamps: (itemNo: string, created: Date | null, updated: Date | null) =>
    applyImportedTimestamps(itemNo, created, updated),
}))

vi.mock('@/lib/attachmentStore', () => ({
  restoreAttachment: (name: string, bytes: Uint8Array) => restoreAttachment(name, bytes),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    item: { findUnique: (args: unknown) => findUniqueItem(args) },
    image: { findMany: (args: unknown) => findManyImage(args) },
  },
}))

const { importZip } = await import('./importZip')

// 取り込みは本文を流し読みする (メモリに全部載せない) ので、テストからも
// 同じ形 — バイト列の並び — で渡す
const zip = (files: Record<string, Uint8Array>) => chunkedBytes(zipSync(files))

const UUID = '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6'

const noteFile = (itemNo: string, body = '本文', extra = '') =>
  strToU8(
    `---\nitemNo: "${itemNo}"\nmode: memo\nurl: ""\ncreated: 2025-01-01T00:00:00.000Z\nupdated: 2025-02-01T00:00:00.000Z\npublic: false\n${extra}---\n${body}\n`,
  )

beforeEach(() => {
  vi.clearAllMocks()
  upsertItem.mockResolvedValue(undefined)
  setItemPublic.mockResolvedValue(0)
  applyImportedTimestamps.mockResolvedValue(undefined)
  executeRaw.mockResolvedValue(1)
  findUniqueItem.mockResolvedValue(null) // 既定は「その番号は空いている」
  findManyImage.mockResolvedValue([])
  restoreAttachment.mockResolvedValue({ ok: true, created: true })
})

test('notes/*.md を番号ごと戻す', async () => {
  const report = await importZip(zip({ 'notes/1042.md': noteFile('1042') }))

  expect(report.imported).toEqual([{ itemNo: '1042', title: '本文' }])
  expect(upsertItem).toHaveBeenCalledWith('1042', {
    memo: '本文',
    url: '',
    mode: 'memo',
  })
})

// 書き出した日時をそのまま戻す。しないと戻したノートが全部「いま」に並ぶ
test('作成・更新日時を書き戻す', async () => {
  await importZip(zip({ 'notes/1042.md': noteFile('1042') }))
  expect(applyImportedTimestamps).toHaveBeenCalledWith(
    '1042',
    new Date('2025-01-01T00:00:00.000Z'),
    new Date('2025-02-01T00:00:00.000Z'),
  )
})

test('公開状態もファイルに合わせる', async () => {
  const file = strToU8(
    '---\nitemNo: "7"\nmode: memo\nurl: ""\npublic: true\n---\n本文\n',
  )
  await importZip(zip({ 'notes/7.md': file }))
  expect(setItemPublic).toHaveBeenCalledWith('7', true)
})

test('images/ の添付を元の名前のまま戻す', async () => {
  await importZip(
    zip({
      'notes/1042.md': noteFile('1042'),
      [`images/${UUID}.jpg`]: new Uint8Array([1, 2, 3]),
    }),
  )

  expect(restoreAttachment).toHaveBeenCalledWith(`${UUID}.jpg`, expect.anything())
})

// 取り込んだ直後の一覧で画像が割れて見える瞬間を作らない
test('添付はノートより先に入れる', async () => {
  const order: string[] = []
  restoreAttachment.mockImplementation(async () => {
    order.push('attachment')
    return { ok: true, created: true }
  })
  upsertItem.mockImplementation(async () => {
    order.push('note')
  })

  await importZip(
    zip({
      'notes/1042.md': noteFile('1042'),
      [`images/${UUID}.jpg`]: new Uint8Array([1, 2, 3]),
    }),
  )

  expect(order).toEqual(['attachment', 'note'])
})

// --- 衝突ポリシー (§5) ---

test('既にある番号は既定では上書きしない', async () => {
  findUniqueItem.mockResolvedValue({ itemNo: '1042' })

  const report = await importZip(zip({ 'notes/1042.md': noteFile('1042') }))

  expect(report.conflictSkipped).toBe(1)
  expect(report.imported).toEqual([])
  expect(upsertItem).not.toHaveBeenCalled()
})

test('overwrite を選んだときだけ上書きする', async () => {
  findUniqueItem.mockResolvedValue({ itemNo: '1042' })

  const report = await importZip(zip({ 'notes/1042.md': noteFile('1042') }), {
    overwrite: true,
  })

  expect(report.conflictSkipped).toBe(0)
  expect(report.imported).toHaveLength(1)
  expect(upsertItem).toHaveBeenCalled()
})

// --- 入らなかったものは必ずレポートに出す ---

test('読めないファイルはそのファイルだけ見送って理由を載せる', async () => {
  const report = await importZip(
    zip({
      'notes/1042.md': noteFile('1042'),
      'notes/broken.md': strToU8('frontmatter がありません'),
    }),
  )

  expect(report.imported).toHaveLength(1)
  expect(report.skipped).toHaveLength(1)
  expect(report.skipped[0].label).toBe('notes/broken.md')
})

test('想定外のパスは黙って読み飛ばさず理由を載せる', async () => {
  const report = await importZip(
    zip({ 'secret/passwd': strToU8('x'), 'README.md': strToU8('x') }),
  )

  expect(report.skipped.map((entry) => entry.label).sort()).toEqual([
    'README.md',
    'secret/passwd',
  ])
})

test('保存できなかった添付を理由付きで載せる', async () => {
  restoreAttachment.mockResolvedValue({
    ok: false,
    reason: '中身が拡張子 (.jpg) と一致しません',
  })

  const report = await importZip(
    zip({ [`images/${UUID}.jpg`]: strToU8('<html>') }),
  )

  expect(report.restoredAttachments).toBe(0)
  expect(report.skipped[0].reason).toContain('拡張子')
})

// 画像切れのノートが「取り込めた」ことになるのを防ぐ
test('本文が指す添付が ZIP にも DB にも無ければ理由を載せる', async () => {
  const report = await importZip(
    zip({ 'notes/1042.md': noteFile('1042', `![](../images/${UUID}.jpg)`) }),
  )

  expect(report.imported).toHaveLength(1)
  expect(report.skipped[0].label).toContain(`${UUID}.jpg`)
})

test('添付が DB に既にあるなら欠落として報告しない', async () => {
  findManyImage.mockResolvedValue([{ name: `${UUID}.jpg` }])

  const report = await importZip(
    zip({ 'notes/1042.md': noteFile('1042', `![](../images/${UUID}.jpg)`) }),
  )

  expect(report.skipped).toEqual([])
})

test('1 件の添付の失敗で ZIP 全体を落とさない', async () => {
  restoreAttachment.mockRejectedValue(new Error('DB が落ちました'))

  const report = await importZip(
    zip({
      'notes/1042.md': noteFile('1042'),
      [`images/${UUID}.jpg`]: new Uint8Array([1, 2, 3]),
    }),
  )

  expect(report.imported).toHaveLength(1)
  expect(report.skipped).toHaveLength(1)
})

test('1 件のノートの失敗で ZIP 全体を落とさない', async () => {
  upsertItem.mockRejectedValueOnce(new Error('デモの上限に達しました'))

  const report = await importZip(
    zip({ 'notes/1.md': noteFile('1'), 'notes/2.md': noteFile('2') }),
  )

  expect(report.imported).toHaveLength(1)
  expect(report.skipped[0].reason).toContain('デモの上限')
})

// 同じ ZIP を二度取り込んでも増えない (再実行が安全であること)
test('同じ名前の添付が既にあれば数に入れない', async () => {
  restoreAttachment.mockResolvedValue({ ok: true, created: false })

  const report = await importZip(
    zip({ [`images/${UUID}.jpg`]: new Uint8Array([1, 2, 3]) }),
  )

  expect(report.restoredAttachments).toBe(0)
  expect(report.deferredImageIndex).toBe(0)
})

test('ZIP として読めないファイルは例外 (ファイルごと対象外)', async () => {
  await expect(importZip(chunkedBytes(strToU8('ただのテキスト')))).rejects.toThrow(
    /ZIP ファイルではありません/,
  )
})

// --- 進捗の知らせ (docs/28 §9) ---

test('ノートの反映の始まりと 1 件ごとを知らせる', async () => {
  const onNotesStart = vi.fn()
  const onNoteDone = vi.fn()

  await importZip(zip({ 'notes/1.md': noteFile('1'), 'notes/2.md': noteFile('2') }), {
    onNotesStart,
    onNoteDone,
  })

  expect(onNotesStart).toHaveBeenCalledWith(2)
  expect(onNoteDone).toHaveBeenCalledTimes(2)
})

// 分母は「読んだファイル数」なので、見送ったものも 1 件進んだことにしないと
// 最後まで到達しない
test('見送ったノートも 1 件進んだことにする', async () => {
  const onNoteDone = vi.fn()

  await importZip(
    zip({
      'notes/1.md': noteFile('1'),
      'notes/broken.md': strToU8('frontmatter がありません'),
    }),
    { onNoteDone },
  )

  expect(onNoteDone).toHaveBeenCalledTimes(2)
})

test('衝突で見送ったノートも 1 件進んだことにする', async () => {
  findUniqueItem.mockResolvedValue({ itemNo: '1' })
  const onNoteDone = vi.fn()

  await importZip(zip({ 'notes/1.md': noteFile('1') }), { onNoteDone })

  expect(onNoteDone).toHaveBeenCalledTimes(1)
})

// 進捗は表示の補助でしかない。渡さなくても取り込めること
test('知らせを渡さなくても取り込める', async () => {
  const report = await importZip(zip({ 'notes/1.md': noteFile('1') }))
  expect(report.imported).toHaveLength(1)
})
