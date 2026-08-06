import { expect, test } from 'vitest'
import {
  buildNoteFile,
  collectAttachmentNames,
  parseNoteFile,
  type PortableNote,
} from './noteFile'

const UUID = '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6'

function note(overrides: Partial<PortableNote> = {}): PortableNote {
  return {
    itemNo: '1042',
    memo: 'hFE=208\n2SC1815 のストック #トランジスタ',
    url: '',
    mode: 'memo',
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
      'itemNo: "1042"',
      'mode: memo',
      'url: ""',
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
    url: 'https://example.com/?q="a b"',
    mode: 'url',
    isPublic: true,
  })
  const parsed = parseNoteFile(buildNoteFile(original))
  expect(parsed).toEqual({ ok: true, note: original })
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

test('itemNo が書式外のファイルは理由付きで断る', () => {
  const text = buildNoteFile(note()).replace('itemNo: "1042"', 'itemNo: "../x"')
  const parsed = parseNoteFile(text)
  expect(parsed.ok).toBe(false)
})

test('itemNo が無いファイルは理由付きで断る', () => {
  const text = buildNoteFile(note()).replace('itemNo: "1042"\n', '')
  expect(parseNoteFile(text).ok).toBe(false)
})

test('日時が読めないファイルは理由付きで断る', () => {
  const text = buildNoteFile(note()).replace(
    'created: 2025-11-02T10:30:00.000Z',
    'created: きのう',
  )
  expect(parseNoteFile(text).ok).toBe(false)
})

// 手書きの Markdown も必須項目さえ揃えば取り込める (docs/28 §3)。
// 任意項目は既定へ倒す — mode は memo、url は空、公開はしない
test('任意項目が無くても itemNo だけあれば読める', () => {
  const parsed = parseNoteFile('---\nitemNo: "7"\n---\n本文\n')
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) {
    return
  }
  expect(parsed.note.itemNo).toBe('7')
  expect(parsed.note.mode).toBe('memo')
  expect(parsed.note.url).toBe('')
  expect(parsed.note.isPublic).toBe(false)
  expect(parsed.note.createdAt).toBeNull()
  expect(parsed.note.updatedAt).toBeNull()
})

test('本文が長すぎるファイルは理由付きで断る', () => {
  const text = buildNoteFile(note({ memo: 'あ'.repeat(10001) }))
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
