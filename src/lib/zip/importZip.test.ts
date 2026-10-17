import { strToU8, zipSync } from 'fflate'
import { beforeEach, expect, test, vi } from 'vitest'
import { chunkedBytes } from '@/lib/bytes'
import { MAX_ZIP_FILE_BYTES } from './limits'

// DB と添付の保存は差し替える。確かめたいのは繋ぎ役の振る舞い —
// 「入らなかったものが必ずレポートに出るか」であって Postgres や sharp ではない
// (lib/enex/importEnex.test.ts と同じ流儀)
const upsertMemo = vi.fn()
const setItemPublic = vi.fn()
const applyImportedTimestamps = vi.fn()
const newItemId = vi.fn()
const isAlreadyImported = vi.fn()
const restoreAttachment = vi.fn()
const executeRaw = vi.fn()
const findUniqueItem = vi.fn()
const findManyImage = vi.fn()
const findItemIdsByLegacyNo = vi.fn()

// 新しい id は同期で振る (UUID v7。採番表を引かない)
vi.mock('@/lib/items/itemId', () => ({
  newItemId: () => newItemId(),
}))

// 旧番号 → id はタグ検索 (SQL)。ここでは結果だけを差し替える
vi.mock('@/lib/items/resolve', () => ({
  findItemIdsByLegacyNo: (itemNo: string, options?: unknown) =>
    findItemIdsByLegacyNo(itemNo, options),
}))

vi.mock('@/lib/items/write', () => ({
  upsertMemo: (itemId: string, memo: string) => upsertMemo(itemId, memo),
  applyImportedTimestamps: (itemId: string, created: Date | null, updated: Date | null) =>
    applyImportedTimestamps(itemId, created, updated),
}))

vi.mock('@/lib/items/flags', () => ({
  setItemPublic: (itemId: string, isPublic: boolean) => setItemPublic(itemId, isPublic),
}))

vi.mock('@/lib/import/importDuplicate', () => ({
  isAlreadyImported: (created: Date | null, title: string) =>
    isAlreadyImported(created, title),
}))

vi.mock('@/lib/attachments/restore', () => ({
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

// ノートの仮 id。末尾 12 桁に元の番号を入れて読みやすくする
function id(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`
}

// renumber・旧番号の新規作成で振られる id
const NEW_ID = id(20001)

const noteFile = (itemId: string, body = '本文', extra = '') =>
  strToU8(
    `---\nid: "${itemId}"\ncreated: 2025-01-01T00:00:00.000Z\nupdated: 2025-02-01T00:00:00.000Z\npublic: false\n${extra}---\n${body}\n`,
  )

// v0.24 より前の書き出しと教科書の変換スクリプトが組む形 (旧番号)
const legacyNoteFile = (itemNo: string, body = '本文') =>
  strToU8(
    `---\nitemNo: "${itemNo}"\ncreated: 2025-01-01T00:00:00.000Z\nupdated: 2025-02-01T00:00:00.000Z\npublic: false\n---\n${body}\n`,
  )

// 手書きの Markdown を置いた形 (日時が無い)
const undatedNoteFile = (itemId: string, body = '本文') =>
  strToU8(`---\nid: "${itemId}"\npublic: false\n---\n${body}\n`)

beforeEach(() => {
  vi.clearAllMocks()
  upsertMemo.mockResolvedValue(undefined)
  setItemPublic.mockResolvedValue(0)
  applyImportedTimestamps.mockResolvedValue(undefined)
  executeRaw.mockResolvedValue(1)
  findUniqueItem.mockResolvedValue(null) // 既定は「その id の行は無い」
  findManyImage.mockResolvedValue([])
  restoreAttachment.mockResolvedValue({ ok: true, created: true })
  newItemId.mockReturnValue(NEW_ID)
  findItemIdsByLegacyNo.mockResolvedValue([]) // 既定は「その旧番号のノートは無い」
  isAlreadyImported.mockResolvedValue(false) // 既定は「同内容のノートはいない」
})

test('notes/*.md を id ごと戻す', async () => {
  const report = await importZip(zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042)) }))

  expect(report.imported).toEqual([{ itemId: id(1042), title: '本文' }])
  expect(upsertMemo).toHaveBeenCalledWith(id(1042), '本文')
})

// 書き出した日時をそのまま戻す。しないと戻したノートが全部「いま」に並ぶ
test('作成・更新日時を書き戻す', async () => {
  await importZip(zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042)) }))
  expect(applyImportedTimestamps).toHaveBeenCalledWith(
    id(1042),
    new Date('2025-01-01T00:00:00.000Z'),
    new Date('2025-02-01T00:00:00.000Z'),
  )
})

test('公開状態もファイルに合わせる', async () => {
  const file = strToU8(
    `---\nid: "${id(7)}"\npublic: true\n---\n本文\n`,
  )
  await importZip(zip({ [`notes/${id(7)}.md`]: file }))
  expect(setItemPublic).toHaveBeenCalledWith(id(7), true)
})

test('images/ の添付を元の名前のまま戻す', async () => {
  await importZip(
    zip({
      [`notes/${id(1042)}.md`]: noteFile(id(1042)),
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
  upsertMemo.mockImplementation(async () => {
    order.push('note')
  })

  await importZip(
    zip({
      [`notes/${id(1042)}.md`]: noteFile(id(1042)),
      [`images/${UUID}.jpg`]: new Uint8Array([1, 2, 3]),
    }),
  )

  expect(order).toEqual(['attachment', 'note'])
})

// --- 衝突ポリシー (§5) ---

test('既にある id は既定では上書きしない', async () => {
  findUniqueItem.mockResolvedValue({ itemId: id(1042) })

  const report = await importZip(zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042)) }))

  expect(report.conflictSkipped).toBe(1)
  expect(report.imported).toEqual([])
  expect(upsertMemo).not.toHaveBeenCalled()
})

test('overwrite を選んだときだけ上書きする', async () => {
  findUniqueItem.mockResolvedValue({ itemId: id(1042) })

  const report = await importZip(zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042)) }), {
    conflict: 'overwrite',
  })

  expect(report.conflictSkipped).toBe(0)
  expect(report.imported).toHaveLength(1)
  expect(upsertMemo).toHaveBeenCalled()
})

// --- 新しい id で取り込む (§5「新しい番号で取り込む」) ---

test('renumber は衝突したノートにだけ新しい id を振る', async () => {
  findUniqueItem.mockResolvedValue({ itemId: id(1042) })

  const report = await importZip(zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042)) }), {
    conflict: 'renumber',
  })

  expect(report.conflictSkipped).toBe(0)
  expect(upsertMemo).toHaveBeenCalledWith(NEW_ID, expect.anything())
  // 日時・公開状態も新しい id のほうへ反映する (元の id は既存ノートのもの)
  expect(applyImportedTimestamps).toHaveBeenCalledWith(NEW_ID, expect.anything(), expect.anything())
  expect(setItemPublic).toHaveBeenCalledWith(NEW_ID, false)
})

// 全部を振り直すと、衝突していないノートまで印刷済みの QR シールと切れる
test('renumber でも衝突していないノートは元の id のまま', async () => {
  const report = await importZip(zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042)) }), {
    conflict: 'renumber',
  })

  expect(report.imported).toEqual([{ itemId: id(1042), title: '本文' }])
  expect(newItemId).not.toHaveBeenCalled()
})

// どれが振り直されたか判らないと、QR シールとの対応を確かめられない
test('renumber したノートは元の id を報告に残す', async () => {
  findUniqueItem.mockResolvedValue({ itemId: id(1042) })

  const report = await importZip(zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042)) }), {
    conflict: 'renumber',
  })

  expect(report.imported).toEqual([
    { itemId: NEW_ID, title: '本文', renumberedFrom: id(1042) },
  ])
})

// renumber の罠は再実行。素朴に作ると同じ ZIP を 2 回流した時点で全ノートが
// 複製される (毎回衝突 → 毎回採番)
test('renumber でも同じ内容のノートが既にいれば採番せず見送る', async () => {
  findUniqueItem.mockResolvedValue({ itemId: id(1042) })
  isAlreadyImported.mockResolvedValue(true)

  const report = await importZip(zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042)) }), {
    conflict: 'renumber',
  })

  expect(report.duplicateSkipped).toBe(1)
  expect(report.imported).toEqual([])
  expect(newItemId).not.toHaveBeenCalled()
  expect(upsertMemo).not.toHaveBeenCalled()
  // 照合は「作成日時 + 本文 1 行目」
  expect(isAlreadyImported).toHaveBeenCalledWith(
    new Date('2025-01-01T00:00:00.000Z'),
    '本文',
  )
})

// 日時の無いノート (手書きの Markdown) は照合の鍵が題名だけになる。
// 判定は importDuplicate 側で断るので、ここは「日時を渡す」ことだけ見る
test('日時の無いノートは日時 null のまま判定にかける', async () => {
  findUniqueItem.mockResolvedValue({ itemId: id(7) })

  await importZip(zip({ [`notes/${id(7)}.md`]: undatedNoteFile(id(7)) }), {
    conflict: 'renumber',
  })

  expect(isAlreadyImported).toHaveBeenCalledWith(null, '本文')
  expect(upsertMemo).toHaveBeenCalledWith(NEW_ID, expect.anything())
})

test('衝突で採番したノートも 1 件進んだことにする', async () => {
  findUniqueItem.mockResolvedValue({ itemId: id(1) })
  const onNoteDone = vi.fn()

  await importZip(zip({ [`notes/${id(1)}.md`]: noteFile(id(1)) }), {
    conflict: 'renumber',
    onNoteDone,
  })

  expect(onNoteDone).toHaveBeenCalledTimes(1)
})

// --- 旧形式 (itemNo:) の ZIP (docs/107 §4-2) ---

// 旧番号は移行で本文のタグ #<旧番号> になった。取り込み先の同じノートは
// そのタグで探す (ゴミ箱も含める)
test('旧番号のノートはタグ #<旧番号> で既存ノートを探す (ゴミ箱込み)', async () => {
  await importZip(zip({ 'notes/1042.md': legacyNoteFile('1042') }))

  expect(findItemIdsByLegacyNo).toHaveBeenCalledWith('1042', { includeTrashed: true })
  // id の行は引かない (旧番号は id ではない)
  expect(findUniqueItem).not.toHaveBeenCalled()
})

test('旧番号で 0 件なら新しい id で作り、本文にタグ #<旧番号> を足す', async () => {
  const report = await importZip(zip({ 'notes/1042.md': legacyNoteFile('1042') }))

  expect(newItemId).toHaveBeenCalledTimes(1)
  expect(upsertMemo).toHaveBeenCalledWith(NEW_ID, '本文\n#1042')
  expect(applyImportedTimestamps).toHaveBeenCalledWith(
    NEW_ID,
    new Date('2025-01-01T00:00:00.000Z'),
    new Date('2025-02-01T00:00:00.000Z'),
  )
  expect(setItemPublic).toHaveBeenCalledWith(NEW_ID, false)
  // 新しく作っただけで、振り直しではない
  expect(report.imported).toEqual([{ itemId: NEW_ID, title: '本文' }])
})

// 教科書の変換スクリプトが組む ZIP の番号の形
test('英字混じりの旧番号も同じように扱う', async () => {
  await importZip(zip({ 'notes/wb01-03-08.md': legacyNoteFile('wb01-03-08') }))

  expect(findItemIdsByLegacyNo).toHaveBeenCalledWith('wb01-03-08', { includeTrashed: true })
  expect(upsertMemo).toHaveBeenCalledWith(NEW_ID, '本文\n#wb01-03-08')
})

// 本文に既にタグがあれば二重に足さない (再取り込み・移行後に書き出した原稿)
test('本文に既にタグ #<旧番号> があれば足さない', async () => {
  await importZip(zip({ 'notes/1042.md': legacyNoteFile('1042', '本文 #1042') }))

  expect(upsertMemo).toHaveBeenCalledWith(NEW_ID, '本文 #1042')
})

test('旧番号で 1 件なら同じノートとみなし、既定では上書きしない', async () => {
  findItemIdsByLegacyNo.mockResolvedValue([id(1042)])

  const report = await importZip(zip({ 'notes/1042.md': legacyNoteFile('1042') }))

  expect(report.conflictSkipped).toBe(1)
  expect(report.imported).toEqual([])
  expect(upsertMemo).not.toHaveBeenCalled()
})

// 上書きは見つけた行の id へ。入ってくる本文 (教科書の原稿など) にはタグが
// 無いので足す — 足さないと次の取り込みでそのノートを見つけられない
test('旧番号で 1 件なら overwrite はその id へ書き、タグも足す', async () => {
  findItemIdsByLegacyNo.mockResolvedValue([id(1042)])

  const report = await importZip(zip({ 'notes/1042.md': legacyNoteFile('1042') }), {
    conflict: 'overwrite',
  })

  expect(upsertMemo).toHaveBeenCalledWith(id(1042), '本文\n#1042')
  expect(applyImportedTimestamps).toHaveBeenCalledWith(id(1042), expect.anything(), expect.anything())
  expect(setItemPublic).toHaveBeenCalledWith(id(1042), false)
  expect(report.imported).toEqual([{ itemId: id(1042), title: '本文' }])
})

test('旧番号で 1 件なら renumber は新しい id で作り、元の id を報告に残す', async () => {
  findItemIdsByLegacyNo.mockResolvedValue([id(1042)])

  const report = await importZip(zip({ 'notes/1042.md': legacyNoteFile('1042') }), {
    conflict: 'renumber',
  })

  expect(upsertMemo).toHaveBeenCalledWith(NEW_ID, '本文\n#1042')
  expect(report.imported).toEqual([
    { itemId: NEW_ID, title: '本文', renumberedFrom: id(1042) },
  ])
})

// どれを指すか決められないので、上書きも振り直しも当て推量になる
test.each(['skip', 'overwrite', 'renumber'] as const)(
  '旧番号で 2 件以上なら衝突として見送る (%s)',
  async (conflict) => {
    findItemIdsByLegacyNo.mockResolvedValue([id(1), id(2)])
    const onNoteDone = vi.fn()

    const report = await importZip(zip({ 'notes/1042.md': legacyNoteFile('1042') }), {
      conflict,
      onNoteDone,
    })

    expect(report.conflictSkipped).toBe(1)
    expect(report.imported).toEqual([])
    expect(upsertMemo).not.toHaveBeenCalled()
    expect(newItemId).not.toHaveBeenCalled()
    expect(isAlreadyImported).not.toHaveBeenCalled()
    expect(onNoteDone).toHaveBeenCalledTimes(1)
  },
)

// 新旧の形が 1 つの ZIP に混ざっても、それぞれの探し方で入る
test('id のノートと旧番号のノートが混ざった ZIP も取り込める', async () => {
  const report = await importZip(
    zip({
      [`notes/${id(7)}.md`]: noteFile(id(7)),
      'notes/1042.md': legacyNoteFile('1042'),
    }),
  )

  expect(report.imported).toHaveLength(2)
  expect(upsertMemo).toHaveBeenCalledWith(id(7), '本文')
  expect(upsertMemo).toHaveBeenCalledWith(NEW_ID, '本文\n#1042')
})

// id のノートは id のまま入れる (別インスタンスへ移しても URL が変わらない)。
// 旧番号の探し方には回さない
test('id のノートは id の行だけを見て、タグは足さない', async () => {
  await importZip(zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042)) }))

  expect(findUniqueItem).toHaveBeenCalledWith(
    expect.objectContaining({ where: { itemId: id(1042) } }),
  )
  expect(findItemIdsByLegacyNo).not.toHaveBeenCalled()
  expect(newItemId).not.toHaveBeenCalled()
  expect(upsertMemo).toHaveBeenCalledWith(id(1042), '本文')
})

// 保存に失敗したときの報告の見出しは「#旧番号」で出す (id は無いので)
test('旧番号のノートの保存に失敗したら #<旧番号> で報告する', async () => {
  upsertMemo.mockRejectedValueOnce(new Error('デモの上限に達しました'))

  const report = await importZip(zip({ 'notes/1042.md': legacyNoteFile('1042') }))

  expect(report.skipped).toEqual([
    { label: 'notes/1042.md (#1042)', reason: expect.stringContaining('デモの上限') },
  ])
})

// --- 入らなかったものは必ずレポートに出す ---

test('読めないファイルはそのファイルだけ見送って理由を載せる', async () => {
  const report = await importZip(
    zip({
      [`notes/${id(1042)}.md`]: noteFile(id(1042)),
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
      [`notes/${id(1042)}.md`]: noteFile(id(1042)),
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
      [`notes/${id(1042)}.md`]: noteFile(id(1042)),
      '__MACOSX/._notes': strToU8('x'),
      '.DS_Store': strToU8('x'),
    }),
  )

  expect(report.imported).toHaveLength(1)
  expect(report.skipped).toHaveLength(2)
})

// 0 件のときの書き出しがこの形 (export.json だけ)。中身が空なのと
// 選び間違えたのとは別の話なので、断らない。
//
// 名乗りが旧名 (qr-search-export) なのはわざと — 取り込みは format を見ないので、
// 改名前に書き出した ZIP も同じように通ることをここで押さえておく
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
      [`notes/${id(1042)}.md`]: noteFile(id(1042)),
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
    zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042), `![](../images/${UUID}.jpg)`) }),
  )

  expect(report.imported).toHaveLength(1)
  expect(report.skipped[0].label).toContain(`${UUID}.jpg`)
})

test('添付が DB に既にあるなら欠落として報告しない', async () => {
  findManyImage.mockResolvedValue([{ name: `${UUID}.jpg` }])

  const report = await importZip(
    zip({ [`notes/${id(1042)}.md`]: noteFile(id(1042), `![](../images/${UUID}.jpg)`) }),
  )

  expect(report.skipped).toEqual([])
})

test('1 件の添付の失敗で ZIP 全体を落とさない', async () => {
  restoreAttachment.mockRejectedValue(new Error('DB が落ちました'))

  const report = await importZip(
    zip({
      [`notes/${id(1042)}.md`]: noteFile(id(1042)),
      [`images/${UUID}.jpg`]: new Uint8Array([1, 2, 3]),
    }),
  )

  expect(report.imported).toHaveLength(1)
  expect(report.skipped).toHaveLength(1)
})

test('1 件のノートの失敗で ZIP 全体を落とさない', async () => {
  upsertMemo.mockRejectedValueOnce(new Error('デモの上限に達しました'))

  const report = await importZip(
    zip({ [`notes/${id(1)}.md`]: noteFile(id(1)), [`notes/${id(2)}.md`]: noteFile(id(2)) }),
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

  await importZip(zip({ [`notes/${id(1)}.md`]: noteFile(id(1)), [`notes/${id(2)}.md`]: noteFile(id(2)) }), {
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
      [`notes/${id(1)}.md`]: noteFile(id(1)),
      'notes/broken.md': strToU8('frontmatter がありません'),
    }),
    { onNoteDone },
  )

  expect(onNoteDone).toHaveBeenCalledTimes(2)
})

test('衝突で見送ったノートも 1 件進んだことにする', async () => {
  findUniqueItem.mockResolvedValue({ itemId: id(1) })
  const onNoteDone = vi.fn()

  await importZip(zip({ [`notes/${id(1)}.md`]: noteFile(id(1)) }), { onNoteDone })

  expect(onNoteDone).toHaveBeenCalledTimes(1)
})

// 進捗は表示の補助でしかない。渡さなくても取り込めること
test('知らせを渡さなくても取り込める', async () => {
  const report = await importZip(zip({ [`notes/${id(1)}.md`]: noteFile(id(1)) }))
  expect(report.imported).toHaveLength(1)
})
