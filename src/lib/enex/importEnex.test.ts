import { beforeEach, expect, test, vi } from 'vitest'
import { MAX_TEXT_LENGTH } from '@/lib/validation'

// DB と添付の保存は差し替える。ここで確かめたいのは繋ぎ役の振る舞い —
// 「入らなかったものが必ずレポートに出るか」であって、Postgres や sharp ではない
const upsertItem = vi.fn()
const nextItemNo = vi.fn()
const applyImportedTimestamps = vi.fn()
const storeAttachment = vi.fn()
const executeRaw = vi.fn()
const deleteMany = vi.fn()
const isAlreadyImported = vi.fn()

vi.mock('@/lib/items', () => ({
  nextItemNo: () => nextItemNo(),
  upsertItem: (itemNo: string, data: unknown) => upsertItem(itemNo, data),
  applyImportedTimestamps: (itemNo: string, created: Date | null, updated: Date | null) =>
    applyImportedTimestamps(itemNo, created, updated),
}))

vi.mock('@/lib/attachmentStore', () => ({
  storeAttachment: (bytes: Uint8Array, options?: unknown) =>
    storeAttachment(bytes, options),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    image: { deleteMany: (args: unknown) => deleteMany(args) },
  },
}))

// 重複判定は ZIP の renumber と共有する (lib/importDuplicate.ts)。
// 判定そのものは lib/importDuplicate.test.ts が見るので、ここでは
// 「いつ呼ぶか・呼んだ結果をどう扱うか」だけを差し替えて確かめる
vi.mock('@/lib/importDuplicate', () => ({
  isAlreadyImported: (created: Date | null, title: string) =>
    isAlreadyImported(created, title),
}))

const { importEnex } = await import('./importEnex')

// 1x1 の透明 PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const enml = (body: string) => `<![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<en-note>${body}</en-note>]]>`

const enex = (notes: string) => `<?xml version="1.0" encoding="UTF-8"?>
<en-export application="Evernote" version="10.98.3">${notes}</en-export>`

const note = (inner: string) => `<note>${inner}</note>`

beforeEach(() => {
  vi.clearAllMocks()
  let no = 1000
  nextItemNo.mockImplementation(async () => String(no++))
  upsertItem.mockResolvedValue(undefined)
  executeRaw.mockResolvedValue(1)
  applyImportedTimestamps.mockResolvedValue(undefined)
  isAlreadyImported.mockResolvedValue(false) // 既定は重複なし
  deleteMany.mockResolvedValue({ count: 0 })
  storeAttachment.mockResolvedValue({
    ok: true,
    url: '/api/images/11111111-1111-1111-1111-111111111111.png',
    name: '11111111-1111-1111-1111-111111111111.png',
    isImage: true,
  })
})

test('ノートを採番して保存する', async () => {
  const report = await importEnex(
    enex(note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>`)),
  )

  expect(report.imported).toEqual([{ itemNo: '1000', title: '題名' }])
  expect(report.skipped).toEqual([])
  expect(upsertItem).toHaveBeenCalledWith('1000', {
    memo: '題名\n\n本文',
    url: '',
    mode: 'memo',
  })
})

test('複数ノートには別々の番号を振る', async () => {
  const report = await importEnex(
    enex(
      note(`<title>A</title><content>${enml('<div>a</div>')}</content>`) +
        note(`<title>B</title><content>${enml('<div>b</div>')}</content>`),
    ),
  )
  expect(report.imported.map((n) => n.itemNo)).toEqual(['1000', '1001'])
})

// --- 重複判定 (docs/28 §4) ---

const noteWithDate = (title: string) =>
  note(
    `<title>${title}</title><content>${enml('<div>本文</div>')}</content>` +
      '<created>20240115T093000Z</created>',
  )

test('既に取り込み済みのノートはスキップして数える', async () => {
  isAlreadyImported.mockResolvedValue(true)

  const report = await importEnex(enex(noteWithDate('うどん')))

  expect(report.imported).toEqual([])
  expect(report.duplicateSkipped).toBe(1)
  expect(upsertItem).not.toHaveBeenCalled()
  // 添付の保存より前に弾くので、ゴミも残らない
  expect(storeAttachment).not.toHaveBeenCalled()
})

test('--force (allowDuplicate) なら重複でも入れ直す', async () => {
  isAlreadyImported.mockResolvedValue(true)

  const report = await importEnex(enex(noteWithDate('うどん')), {
    allowDuplicate: true,
  })

  expect(report.imported).toHaveLength(1)
  expect(report.duplicateSkipped).toBe(0)
  // 判定自体を撃たない (allowDuplicate のとき isAlreadyImported を呼ばない)
  expect(isAlreadyImported).not.toHaveBeenCalled()
})

// 日時の無いノートは題名だけの照合になり、同名の別ノートを取り違えるので
// 判定対象から外す (常に新規)。断るのは importDuplicate 側なので、
// ここは「日時が無いことを隠さずに渡す」ところまでを見る
test('日時の無いノートは日時 null のまま判定にかける', async () => {
  const report = await importEnex(
    enex(note(`<title>無題</title><content>${enml('<div>x</div>')}</content>`)),
  )

  expect(report.imported).toHaveLength(1)
  expect(isAlreadyImported).toHaveBeenCalledWith(null, '無題')
})

// --- ノート数の上限 ---

test('既定では 500 件を超えると切り捨ててレポートに載せる', async () => {
  const many = Array.from(
    { length: 3 },
    (_, i) => note(`<title>n${i}</title><content>${enml('<div>x</div>')}</content>`),
  ).join('')

  const report = await importEnex(enex(many), { maxNotes: 2 })

  expect(report.imported).toHaveLength(2)
  expect(report.skipped).toHaveLength(1)
  expect(report.skipped[0].reason).toMatch(/2 件までです/)
})

test('maxNotes を Infinity にすると全件取り込む (CLI の挙動)', async () => {
  const many = Array.from(
    { length: 5 },
    (_, i) => note(`<title>n${i}</title><content>${enml('<div>x</div>')}</content>`),
  ).join('')

  const report = await importEnex(enex(many), {
    maxNotes: Number.POSITIVE_INFINITY,
  })

  expect(report.imported).toHaveLength(5)
  expect(report.skipped).toEqual([])
})

// --- 固定タグ (#evernote など) ---

test('fixedTags を全ノートの memo 先頭タグ行へ入れる', async () => {
  await importEnex(
    enex(note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>`)),
    { fixedTags: ['evernote', 'レシピ'] },
  )

  const memo = upsertItem.mock.calls[0][1].memo as string
  expect(memo).toBe('題名\n\n#evernote #レシピ\n\n本文')
})

test('固定タグと ENEX のタグは両方入り、重複は畳む', async () => {
  await importEnex(
    enex(
      `<note><title>題名</title><content>${enml('<div>本文</div>')}</content>` +
        '<tag>レシピ</tag><tag>和食</tag></note>',
    ),
    { fixedTags: ['evernote', 'レシピ'] },
  )

  const memo = upsertItem.mock.calls[0][1].memo as string
  // 固定タグが先、その後に ENEX のタグ。'レシピ' は重複なので 1 回だけ
  expect(memo).toContain('#evernote #レシピ #和食')
})

// --- 入らなかったものが必ずレポートに出るか ---

test('base64 として読めない添付をレポートに載せる', async () => {
  const report = await importEnex(
    enex(
      note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>
        <resource>
          <data encoding="hex">deadbeef</data>
          <mime>image/png</mime>
          <resource-attributes><file-name>壊れた.png</file-name></resource-attributes>
        </resource>`),
    ),
  )

  expect(report.imported).toHaveLength(1)
  expect(report.skipped).toHaveLength(1)
  expect(report.skipped[0].label).toContain('壊れた.png')
})

test('保存を断られた添付をレポートに載せる', async () => {
  storeAttachment.mockResolvedValue({ ok: false, reason: '対応していない形式です' })

  const report = await importEnex(
    enex(
      note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>
        <resource>
          <data encoding="base64">${PNG_BASE64}</data>
          <mime>application/zip</mime>
          <resource-attributes><file-name>資料.zip</file-name></resource-attributes>
        </resource>`),
    ),
  )

  expect(report.skipped).toHaveLength(1)
  expect(report.skipped[0].label).toContain('資料.zip')
  expect(report.skipped[0].reason).toBe('対応していない形式です')
})

// 本文だけに跡を残しても、全ノートを目視するまで気づけない
test('参照先の無い en-media をレポートに載せる', async () => {
  const report = await importEnex(
    enex(
      note(
        `<title>題名</title><content>${enml('<div><en-media hash="deadbeef"/></div>')}</content>`,
      ),
    ),
  )

  expect(report.skipped).toHaveLength(1)
  expect(report.skipped[0].label).toContain('deadbeef')
  // 本文にも跡が残っていること
  expect(upsertItem.mock.calls[0][1].memo).toContain('取り込めませんでした')
})

test('暗号化された部分をレポートに載せる', async () => {
  const report = await importEnex(
    enex(
      note(
        `<title>題名</title><content>${enml('<div><en-crypt>abc</en-crypt></div>')}</content>`,
      ),
    ),
  )
  expect(report.skipped).toHaveLength(1)
  expect(report.skipped[0].reason).toContain('端末側の鍵')
})

test('タグとして書けないタグをレポートに載せる', async () => {
  const report = await importEnex(
    enex(
      note(
        `<title>題名</title><content>${enml('<div>本文</div>')}</content><tag>!!!</tag>`,
      ),
    ),
  )
  expect(report.skipped).toHaveLength(1)
  expect(report.skipped[0].label).toContain('!!!')
})

test('長すぎるノートは保存せず、保存済みの添付を消す', async () => {
  const long = 'あ'.repeat(MAX_TEXT_LENGTH + 1)
  const report = await importEnex(
    enex(
      note(`<title>題名</title><content>${enml(`<div>${long}</div>`)}</content>
        <resource><data encoding="base64">${PNG_BASE64}</data><mime>image/png</mime></resource>`),
    ),
  )

  expect(report.imported).toEqual([])
  expect(upsertItem).not.toHaveBeenCalled()
  expect(report.skipped.some((s) => s.reason.includes('長すぎます'))).toBe(true)
  expect(deleteMany).toHaveBeenCalledWith({
    where: { name: { in: ['11111111-1111-1111-1111-111111111111.png'] } },
  })
})

// 片付けに失敗しても、利用者に見せる理由は「長すぎる」のままであってほしい
test('添付の片付けに失敗しても本当の理由を報告する', async () => {
  deleteMany.mockRejectedValue(new Error('DB が落ちている'))
  const long = 'あ'.repeat(MAX_TEXT_LENGTH + 1)

  const report = await importEnex(
    enex(
      note(`<title>題名</title><content>${enml(`<div>${long}</div>`)}</content>
        <resource><data encoding="base64">${PNG_BASE64}</data><mime>image/png</mime></resource>`),
    ),
  )

  expect(report.skipped.some((s) => s.reason.includes('長すぎます'))).toBe(true)
  expect(report.skipped.some((s) => s.reason.includes('DB が落ちている'))).toBe(false)
})

// 1 件の失敗でファイル 1 枚を落とさない
test('1 件のノートが失敗しても残りは取り込む', async () => {
  upsertItem.mockRejectedValueOnce(new Error('保存できません'))

  const report = await importEnex(
    enex(
      note(`<title>A</title><content>${enml('<div>a</div>')}</content>`) +
        note(`<title>B</title><content>${enml('<div>b</div>')}</content>`),
    ),
  )

  expect(report.imported.map((n) => n.title)).toEqual(['B'])
  expect(report.skipped[0].reason).toBe('保存できません')
})

// 長さ超過だけでなく、どんなやめ方でも参照されない添付を残さない
test('保存に失敗したノートの添付も消す', async () => {
  upsertItem.mockRejectedValue(new Error('保存できません'))

  await importEnex(
    enex(
      note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>
        <resource><data encoding="base64">${PNG_BASE64}</data><mime>image/png</mime></resource>`),
    ),
  )

  expect(deleteMany).toHaveBeenCalledWith({
    where: { name: { in: ['11111111-1111-1111-1111-111111111111.png'] } },
  })
})

// 行ができた後に転んだノートを「入らなかった」と報告すると、
// 取り込み直して二重に作ってしまう
test('日時の反映で転んでも取り込み済みとして報告する', async () => {
  applyImportedTimestamps.mockRejectedValue(new Error('DB が落ちている'))

  const report = await importEnex(
    enex(
      note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>
        <created>20240115T093000Z</created><updated>20240220T101500Z</updated>`),
    ),
  )

  expect(report.imported).toEqual([{ itemNo: '1000', title: '題名' }])
  expect(report.skipped.some((s) => s.label.includes('日時'))).toBe(true)
})

// 変換を始めた時点でイベントループが塞がるので、始める前に断る
test('入れ子が深すぎるノートは変換せず見送る', async () => {
  const deep = '<div>'.repeat(300) + 'x' + '</div>'.repeat(300)
  const report = await importEnex(
    enex(note(`<title>題名</title><content>${enml(deep)}</content>`)),
  )

  expect(report.imported).toEqual([])
  expect(upsertItem).not.toHaveBeenCalled()
  expect(report.skipped[0].reason).toMatch(/入れ子/)
})

// --- 日時 ---

test('ENEX の日時を反映する', async () => {
  await importEnex(
    enex(
      note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>
        <created>20240115T093000Z</created><updated>20240220T101500Z</updated>`),
    ),
  )
  expect(applyImportedTimestamps).toHaveBeenCalledWith(
    '1000',
    new Date('2024-01-15T09:30:00.000Z'),
    new Date('2024-02-20T10:15:00.000Z'),
  )
})

// 日時をどう埋めるか (片方だけのとき・両方無いとき) の判断は items.ts が持つ
test('日時が無いノートは null のまま渡す (取り込んだ時刻のまま)', async () => {
  await importEnex(
    enex(note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>`)),
  )
  expect(applyImportedTimestamps).toHaveBeenCalledWith('1000', null, null)
})

// --- 同じ添付の重複 ---

// 一括取り込みで埋め込みを作ると、モデル読み込みだけで RSS が 475MB 増える
// (本番 VPS は RAM 2GB)。後回しにしたことは画面で知らせる
test('画像の埋め込みは作らず、その枚数を返す', async () => {
  const report = await importEnex(
    enex(
      note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>
        <resource><data encoding="base64">${PNG_BASE64}</data><mime>image/png</mime></resource>`),
    ),
  )

  expect(storeAttachment).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ deferEmbedding: true }),
  )
  expect(report.deferredImageIndex).toBe(1)
})

// ローカルからの一括取り込みはメモリに余裕があるので、その場で索引まで作る。
// **待つ**のが要点 — CLI は取り込み後すぐ接続を畳むので、待たないと
// 最後の数枚の埋め込みが切断と競合して黙って欠ける
test('embedImages を立てると埋め込みを作って待つ', async () => {
  const report = await importEnex(
    enex(
      note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>
        <resource><data encoding="base64">${PNG_BASE64}</data><mime>image/png</mime></resource>`),
    ),
    { embedImages: true },
  )

  expect(storeAttachment).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ deferEmbedding: false, awaitEmbedding: true }),
  )
  // その場で作ったので「後回しにした枚数」には数えない
  expect(report.deferredImageIndex).toBe(0)
})

// 10MB は HTTP アップロードの都合で決めた値。ファイルから読む CLI には
// 持ち込まない (iPhone の写真は普通に超える)
test('添付 1 件の上限を呼び出し側から渡せる', async () => {
  await importEnex(
    enex(
      note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>
        <resource><data encoding="base64">${PNG_BASE64}</data><mime>image/png</mime></resource>`),
    ),
    { maxAttachmentBytes: 50 * 1024 * 1024 },
  )

  expect(storeAttachment).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ maxBytes: 50 * 1024 * 1024 }),
  )
})

test('画像でない添付は枚数に数えない', async () => {
  storeAttachment.mockResolvedValue({
    ok: true,
    url: '/api/images/22222222-2222-2222-2222-222222222222.pdf',
    name: '22222222-2222-2222-2222-222222222222.pdf',
    isImage: false,
  })

  const report = await importEnex(
    enex(
      note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>
        <resource><data encoding="base64">${PNG_BASE64}</data><mime>application/pdf</mime></resource>`),
    ),
  )
  expect(report.deferredImageIndex).toBe(0)
})

test('同じ添付を 2 回参照していても保存は 1 回', async () => {
  await importEnex(
    enex(
      note(`<title>題名</title><content>${enml('<div>本文</div>')}</content>
        <resource><data encoding="base64">${PNG_BASE64}</data><mime>image/png</mime></resource>
        <resource><data encoding="base64">${PNG_BASE64}</data><mime>image/png</mime></resource>`),
    ),
  )
  expect(storeAttachment).toHaveBeenCalledTimes(1)
})
