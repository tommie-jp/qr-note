import { expect, test } from 'vitest'
import { MAX_TEXT_LENGTH } from '@/lib/validation'
import {
  buildNoteFile,
  collectAttachmentNames,
  parseNoteFile,
  type ExportNote,
  type PortableNote,
  foldLegacyUrl,
} from './noteFile'

const UUID = '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6'
const ITEM_ID = '00000000-0000-7000-8000-000000001042'

function note(overrides: Partial<ExportNote> = {}): ExportNote {
  return {
    itemId: ITEM_ID,
    memo: 'hFE=208\n2SC1815 のストック #トランジスタ',
    createdAt: new Date('2025-11-02T10:30:00.000Z'),
    updatedAt: new Date('2026-07-01T08:12:00.000Z'),
    isPublic: false,
    ...overrides,
  }
}

// --- 書き出し ---

test('frontmatter + 本文の Markdown になる', () => {
  expect(buildNoteFile(note())).toBe(
    [
      '---',
      `id: "${ITEM_ID}"`,
      'created: 2025-11-02T10:30:00.000Z',
      'updated: 2026-07-01T08:12:00.000Z',
      'public: false',
      '---',
      'hFE=208',
      '2SC1815 のストック #トランジスタ',
      '',
    ].join('\n'),
  )
})

test('公開ノートは public: true', () => {
  expect(buildNoteFile(note({ isPublic: true }))).toContain('public: true')
})

// 本文はそのまま。ZIP を Obsidian の vault に置いてそのまま読めるよう、
// 画像の参照だけを相対パスへ寄せる (docs/28 §1)
test('本文の /api/images/ は ../images/ へ書き換える', () => {
  const memo = `写真\n![](/api/images/${UUID}.jpg)`
  expect(buildNoteFile(note({ memo }))).toContain(`![](../images/${UUID}.jpg)`)
})

// --- 読み込み ---

test('書き出したファイルを読むと元のノートに戻る', () => {
  const original = note({
    memo: `本文\n![](/api/images/${UUID}.jpg)\n[資料](/api/images/${UUID}.pdf)`,
    isPublic: true,
  })
  const parsed = parseNoteFile(buildNoteFile(original))
  const { itemId, ...rest } = original
  const expected: PortableNote = { key: { kind: 'id', itemId }, ...rest }
  expect(parsed).toEqual({ ok: true, note: expected })
})

test('末尾の改行の有無で本文が変わらない', () => {
  const text = buildNoteFile(note({ memo: '本文' }))
  const parsed = parseNoteFile(text)
  expect(parsed.ok && parsed.note.memo).toBe('本文')
})

test('frontmatter が無いファイルは理由付きで断る', () => {
  const parsed = parseNoteFile('ただの Markdown\n')
  expect(parsed.ok).toBe(false)
})

test('id が書式外のファイルは理由付きで断る', () => {
  const text = buildNoteFile(note()).replace(`id: "${ITEM_ID}"`, 'id: "../x"')
  const parsed = parseNoteFile(text)
  expect(parsed.ok).toBe(false)
})

// id は UUID の小文字表記だけ。旧番号を id: に書いたものは通さない
test('id に旧番号や大文字の UUID を書いたファイルは断る', () => {
  for (const bad of ['1042', UUID.toUpperCase()]) {
    const text = buildNoteFile(note()).replace(`id: "${ITEM_ID}"`, `id: "${bad}"`)
    expect(parseNoteFile(text).ok).toBe(false)
  }
})

test('id も itemNo も無いファイルは理由付きで断る', () => {
  const text = buildNoteFile(note()).replace(`id: "${ITEM_ID}"\n`, '')
  expect(parseNoteFile(text).ok).toBe(false)
})

// --- 旧形式 (itemNo:) ---

// v0.24 より前の書き出しと、教科書の変換スクリプトが組む ZIP
test('旧形式の itemNo: は旧番号のノートとして読む', () => {
  const parsed = parseNoteFile('---\nitemNo: "1042"\nmode: memo\n---\n本文\n')
  expect(parsed).toEqual({
    ok: true,
    note: expect.objectContaining({ key: { kind: 'legacy', itemNo: '1042' }, memo: '本文' }),
  })
})

test('英字混じりの旧番号 (教科書の wb01-03-08) も読む', () => {
  const parsed = parseNoteFile('---\nitemNo: "wb01-03-08"\n---\n本文\n')
  expect(parsed.ok && parsed.note.key).toEqual({ kind: 'legacy', itemNo: 'wb01-03-08' })
})

test('旧番号が書式外のファイルは理由付きで断る', () => {
  const parsed = parseNoteFile('---\nitemNo: "../x"\n---\n本文\n')
  expect(parsed.ok).toBe(false)
})

// UUID を itemNo: に書いたものは旧番号ではない (isLegacyItemNo が外す)
test('itemNo: に UUID を書いたファイルは断る', () => {
  const parsed = parseNoteFile(`---\nitemNo: "${ITEM_ID}"\n---\n本文\n`)
  expect(parsed.ok).toBe(false)
})

// 両方あれば id が正本 (旧番号は本文のタグにも入っている)
test('id と itemNo の両方があれば id を使う', () => {
  const parsed = parseNoteFile(`---\nid: "${ITEM_ID}"\nitemNo: "1042"\n---\n本文\n`)
  expect(parsed.ok && parsed.note.key).toEqual({ kind: 'id', itemId: ITEM_ID })
})

test('日時が読めないファイルは理由付きで断る', () => {
  const text = buildNoteFile(note()).replace(
    'created: 2025-11-02T10:30:00.000Z',
    'created: きのう',
  )
  expect(parseNoteFile(text).ok).toBe(false)
})

// 手書きの Markdown も必須項目さえ揃えば取り込める (docs/28 §3)。
// 任意項目は既定へ倒す — 公開はしない
test('任意項目が無くても id だけあれば読める', () => {
  const parsed = parseNoteFile(`---\nid: "${ITEM_ID}"\n---\n本文\n`)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) {
    return
  }
  expect(parsed.note.key).toEqual({ kind: 'id', itemId: ITEM_ID })
  expect(parsed.note.isPublic).toBe(false)
  expect(parsed.note.createdAt).toBeNull()
  expect(parsed.note.updatedAt).toBeNull()
})

test('本文が長すぎるファイルは理由付きで断る', () => {
  // 上限そのものは validation.ts が決める。数を書き写すと、上限を上げた
  // ときにここだけが古い数を守り続ける (docs/74 §7 で 10,000 → 32,000)
  const text = buildNoteFile(note({ memo: 'あ'.repeat(MAX_TEXT_LENGTH + 1) }))
  expect(parseNoteFile(text).ok).toBe(false)
})

// --- 添付の参照集め ---

test('本文が参照する添付を出現順・重複なしで集める', () => {
  const memo = [
    `![](/api/images/${UUID}.jpg)`,
    `[資料](/api/images/${UUID}.pdf)`,
    `もう一度 ![](/api/images/${UUID}.jpg)`,
  ].join('\n')
  expect(collectAttachmentNames(memo)).toEqual([`${UUID}.jpg`, `${UUID}.pdf`])
})

// 一覧サムネ (memoImages) と違い、コードフェンスの中も拾う。書き出しは
// 「本文が参照しているものを落とさない」ことが最優先
test('コードフェンスの中の参照も集める', () => {
  const memo = `\`\`\`\n![](/api/images/${UUID}.png)\n\`\`\``
  expect(collectAttachmentNames(memo)).toEqual([`${UUID}.png`])
})

test('書式外の名前・外部 URL は集めない', () => {
  const memo = [
    '![](https://example.com/a.jpg)',
    '![](/api/images/../secret.jpg)',
    '![](/api/images/evil.svg)',
  ].join('\n')
  expect(collectAttachmentNames(memo)).toEqual([])
})

// --- 旧い ZIP の url / mode (docs/110 で列を廃止。読む側だけ残す) ---

test('旧い ZIP の URL ノート (mode: url) は URL を 1 行目にして本文へ折り込む', () => {
  const parsed = parseNoteFile(
    `---\nid: "${ITEM_ID}"\nmode: url\nurl: "https://example.com/?q=a+b"\n---\n#1001\n`,
  )
  expect(parsed).toEqual({
    ok: true,
    note: expect.objectContaining({ memo: 'https://example.com/?q=a+b\n\n#1001' }),
  })
})

test('旧い ZIP のメモのノートに url があれば、本文の末尾に URL の段落を足す', () => {
  const parsed = parseNoteFile(
    `---\nid: "${ITEM_ID}"\nmode: memo\nurl: "https://example.com/x"\n---\n見出し\n本文\n`,
  )
  expect(parsed).toEqual({
    ok: true,
    note: expect.objectContaining({ memo: '見出し\n本文\n\nhttps://example.com/x' }),
  })
})

test('foldLegacyUrl は url が空なら本文をそのまま返す', () => {
  expect(foldLegacyUrl('本文', '', false)).toBe('本文')
  expect(foldLegacyUrl('本文', ' \n', true)).toBe('本文')
  expect(foldLegacyUrl('本文', ' https://x \n', false)).toBe('本文\n\nhttps://x')
  expect(foldLegacyUrl('', 'https://x', true)).toBe('https://x')
  expect(foldLegacyUrl('1 行だけ', 'https://x', false)).toBe('1 行だけ\n\nhttps://x')
  expect(foldLegacyUrl('', 'https://x', false)).toBe('https://x')
})
