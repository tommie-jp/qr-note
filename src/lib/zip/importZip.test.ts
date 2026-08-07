import { strToU8, zipSync } from 'fflate'
import { beforeEach, expect, test, vi } from 'vitest'
import { chunkedBytes } from '@/lib/bytes'
import { MAX_ZIP_FILE_BYTES } from './limits'

// DB と添付の保存は差し替える。確かめたいのは繋ぎ役の振る舞い —
// 「入らなかったものが必ずレポートに出るか」であって Postgres や sharp ではない
// (lib/enex/importEnex.test.ts と同じ流儀)
const upsertItem = vi.fn()
const setItemPublic = vi.fn()
const applyImportedTimestamps = vi.fn()
const nextItemNo = vi.fn()
const isAlreadyImported = vi.fn()
const restoreAttachment = vi.fn()
const executeRaw = vi.fn()
const findUniqueItem = vi.fn()
const findManyImage = vi.fn()

vi.mock('@/lib/items', () => ({
  upsertItem: (itemNo: string, data: unknown) => upsertItem(itemNo, data),
  setItemPublic: (itemNo: string, isPublic: boolean) => setItemPublic(itemNo, isPublic),
  applyImportedTimestamps: (itemNo: string, created: Date | null, updated: Date | null) =>
    applyImportedTimestamps(itemNo, created, updated),
  nextItemNo: (alsoUsed?: readonly number[]) => nextItemNo(alsoUsed),
}))

vi.mock('@/lib/importDuplicate', () => ({
  isAlreadyImported: (created: Date | null, title: string) =>
    isAlreadyImported(created, title),
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

// 手書きの Markdown を置いた形 (日時が無い)
const undatedNoteFile = (itemNo: string, body = '本文') =>
  strToU8(`---\nitemNo: "${itemNo}"\nmode: memo\nurl: ""\npublic: false\n---\n${body}\n`)

beforeEach(() => {
  vi.clearAllMocks()
  upsertItem.mockResolvedValue(undefined)
  setItemPublic.mockResolvedValue(0)
  applyImportedTimestamps.mockResolvedValue(undefined)
  executeRaw.mockResolvedValue(1)
  findUniqueItem.mockResolvedValue(null) // 既定は「その番号は空いている」
  findManyImage.mockResolvedValue([])
  restoreAttachment.mockResolvedValue({ ok: true, created: true })
  nextItemNo.mockResolvedValue('20001')
  isAlreadyImported.mockResolvedValue(false) // 既定は「同内容のノートはいない」
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
    conflict: 'overwrite',
  })

  expect(report.conflictSkipped).toBe(0)
  expect(report.imported).toHaveLength(1)
  expect(upsertItem).toHaveBeenCalled()
})

// --- 新しい番号で取り込む (§5「新しい番号で取り込む」) ---

test('renumber は衝突したノートにだけ新しい番号を振る', async () => {
  findUniqueItem.mockResolvedValue({ itemNo: '1042' })

  const report = await importZip(zip({ 'notes/1042.md': noteFile('1042') }), {
    conflict: 'renumber',
  })

  expect(report.conflictSkipped).toBe(0)
  expect(upsertItem).toHaveBeenCalledWith('20001', expect.anything())
  // 日時・公開状態も新しい番号のほうへ反映する (元の番号は既存ノートのもの)
  expect(applyImportedTimestamps).toHaveBeenCalledWith('20001', expect.anything(), expect.anything())
  expect(setItemPublic).toHaveBeenCalledWith('20001', false)
})

// 全部を振り直すと、衝突していないノートまで印刷済みの QR シールと切れる
test('renumber でも衝突していないノートは元の番号のまま', async () => {
  const report = await importZip(zip({ 'notes/1042.md': noteFile('1042') }), {
    conflict: 'renumber',
  })

  expect(report.imported).toEqual([{ itemNo: '1042', title: '本文' }])
  expect(nextItemNo).not.toHaveBeenCalled()
})

// どれが振り直されたか判らないと、QR シールとの対応を確かめられない
test('renumber したノートは旧番号を報告に残す', async () => {
  findUniqueItem.mockResolvedValue({ itemNo: '1042' })

  const report = await importZip(zip({ 'notes/1042.md': noteFile('1042') }), {
    conflict: 'renumber',
  })

  expect(report.imported).toEqual([
    { itemNo: '20001', title: '本文', renumberedFrom: '1042' },
  ])
})

// renumber の罠は再実行。素朴に作ると同じ ZIP を 2 回流した時点で全ノートが
// 複製される (毎回衝突 → 毎回採番)
test('renumber でも同じ内容のノートが既にいれば採番せず見送る', async () => {
  findUniqueItem.mockResolvedValue({ itemNo: '1042' })
  isAlreadyImported.mockResolvedValue(true)

  const report = await importZip(zip({ 'notes/1042.md': noteFile('1042') }), {
    conflict: 'renumber',
  })

  expect(report.duplicateSkipped).toBe(1)
  expect(report.imported).toEqual([])
  expect(nextItemNo).not.toHaveBeenCalled()
  expect(upsertItem).not.toHaveBeenCalled()
  // 照合は「作成日時 + 本文 1 行目」
  expect(isAlreadyImported).toHaveBeenCalledWith(
    new Date('2025-01-01T00:00:00.000Z'),
    '本文',
  )
})

// 日時の無いノート (手書きの Markdown) は照合の鍵が題名だけになる。
// 判定は importDuplicate 側で断るので、ここは「日時を渡す」ことだけ見る
test('日時の無いノートは日時 null のまま判定にかける', async () => {
  findUniqueItem.mockResolvedValue({ itemNo: '7' })

  await importZip(zip({ 'notes/7.md': undatedNoteFile('7') }), {
    conflict: 'renumber',
  })

  expect(isAlreadyImported).toHaveBeenCalledWith(null, '本文')
  expect(upsertItem).toHaveBeenCalledWith('20001', expect.anything())
})

// 採番が ZIP の中の別のノートの番号を横取りすると、衝突していなかったノートが
// 後から衝突する (元の番号のまま入るという約束が崩れる)
test('renumber は ZIP 側が使う番号を採番から外す', async () => {
  findUniqueItem.mockImplementation(async (args: { where: { itemNo: string } }) =>
    args.where.itemNo === '1042' ? { itemNo: '1042' } : null,
  )

  await importZip(
    zip({ 'notes/1042.md': noteFile('1042'), 'notes/5.md': noteFile('5') }),
    { conflict: 'renumber' },
  )

  expect(nextItemNo).toHaveBeenCalledWith(expect.arrayContaining([1042, 5]))
})

test('衝突で採番したノートも 1 件進んだことにする', async () => {
  findUniqueItem.mockResolvedValue({ itemNo: '1' })
  const onNoteDone = vi.fn()

  await importZip(zip({ 'notes/1.md': noteFile('1') }), {
    conflict: 'renumber',
    onNoteDone,
  })

  expect(onNoteDone).toHaveBeenCalledTimes(1)
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
    zip({
      'notes/1042.md': noteFile('1042'),
      'secret/passwd': strToU8('x'),
      'README.md': strToU8('x'),
    }),
  )

  expect(report.skipped.map((entry) => entry.label).sort()).toEqual([
    'README.md',
    'secret/passwd',
  ])
})

// --- 別物の ZIP (docs/28 §3) ---

// 「成功 0 件 / 見送り 257 件」の羅列では、壊れているのか選び間違えたのかが
// 判らない。1 行で断る
test('notes/ も images/ も無い ZIP は 1 行で断る', async () => {
  await expect(
    importZip(
      zip({
        'app-win/app.exe': strToU8('MZ...'),
        'app-win/readme.txt': strToU8('x'),
      }),
    ),
  ).rejects.toThrow(/このアプリが書き出した ZIP ではないようです/)
})

// 取り込まない項目の大きさは、こちらの器の都合とは関係がない。
// **1 項目 50MB の門に掛けない**ので、「中の exe が大きすぎます」にならない
test('別物の ZIP に大きなファイルが入っていても大きさでは断らない', async () => {
  const huge = new Uint8Array(MAX_ZIP_FILE_BYTES + 1024)

  await expect(
    importZip(zip({ 'app-win/app.exe': huge })),
  ).rejects.toThrow(/このアプリが書き出した ZIP ではないようです/)
})

test('ノートが 1 件でもあれば、ゴミが混ざっていても取り込む', async () => {
  const report = await importZip(
    zip({
      'notes/1042.md': noteFile('1042'),
      '__MACOSX/._notes': strToU8('x'),
      '.DS_Store': strToU8('x'),
    }),
  )

  expect(report.imported).toHaveLength(1)
  expect(report.skipped).toHaveLength(2)
})

// 0 件のときの書き出しがこの形 (export.json だけ)。中身が空なのと
// 選び間違えたのとは別の話なので、断らない
test('export.json だけの ZIP は空の取り込みとして通す', async () => {
  const report = await importZip(
    zip({ 'export.json': strToU8('{"format":"qr-search-export"}') }),
  )

  expect(report.imported).toEqual([])
  expect(report.skipped).toEqual([])
})

test('export.json は「取り込めなかったもの」に出さない', async () => {
  const report = await importZip(
    zip({
      'export.json': strToU8('{"format":"qr-search-export"}'),
      'notes/1042.md': noteFile('1042'),
    }),
  )

  expect(report.imported).toHaveLength(1)
  expect(report.skipped).toEqual([])
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
