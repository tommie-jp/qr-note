import { expect, test } from 'vitest'
import { classifyEntry, noteEntryPath, attachmentEntryPath } from './layout'

const UUID = '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6'
const ITEM_ID = '00000000-0000-7000-8000-000000001042'

// --- 書き出すときのパス ---

test('ノートは notes/<itemId>.md に置く', () => {
  expect(noteEntryPath(ITEM_ID)).toBe(`notes/${ITEM_ID}.md`)
})

// ファイル名にする前に必ず書式を確かめる。旧番号や大文字の UUID も通さない
test('itemId が不正ならパスを作らずに投げる', () => {
  expect(() => noteEntryPath('1042')).toThrow()
  expect(() => noteEntryPath('100x')).toThrow()
  expect(() => noteEntryPath(UUID.toUpperCase())).toThrow()
  expect(() => noteEntryPath('../etc/passwd')).toThrow()
  expect(() => noteEntryPath('a/b')).toThrow()
  expect(() => noteEntryPath('')).toThrow()
})

test('添付は images/<保存名> に置く', () => {
  expect(attachmentEntryPath(`${UUID}.jpg`)).toBe(`images/${UUID}.jpg`)
})

test('保存名が不正ならパスを作らずに投げる', () => {
  expect(() => attachmentEntryPath('../secret.jpg')).toThrow()
  expect(() => attachmentEntryPath('evil.svg')).toThrow()
})

// --- 読み込むときの振り分け ---

test('notes/*.md はノートとして読む', () => {
  expect(classifyEntry(`notes/${ITEM_ID}.md`)).toEqual({ kind: 'note' })
  // ファイル名は目印でしかない。正本は frontmatter の id なので、
  // id と一致しない名前でも読む (手書きの Markdown・旧形式の notes/1042.md)
  expect(classifyEntry('notes/メモ.md')).toEqual({ kind: 'note' })
  expect(classifyEntry('notes/1042.md')).toEqual({ kind: 'note' })
})

test('images/<保存名> は添付として読む', () => {
  expect(classifyEntry(`images/${UUID}.png`)).toEqual({
    kind: 'attachment',
    name: `${UUID}.png`,
  })
})

// ディレクトリ項目は ZIP の構造でしかないので黙って読み飛ばす
// 書き出しの覚え書き。**直下の他のファイルより先に見る** (README.md のような
// 「notes/ と images/ の外」として断られてはいけない)
test('export.json は覚え書きとして読み分ける', () => {
  expect(classifyEntry('export.json')).toEqual({ kind: 'meta' })
})

test('ディレクトリ項目は skip', () => {
  expect(classifyEntry('notes/')).toEqual({ kind: 'skip' })
  expect(classifyEntry('images/')).toEqual({ kind: 'skip' })
})

// macOS が同梱するメタデータ。人為的なものではないので理由付きで落とす
test('見に覚えのないパスは reject (理由付き)', () => {
  expect(classifyEntry(`__MACOSX/notes/${ITEM_ID}.md`).kind).toBe('reject')
  expect(classifyEntry('notes/1042.txt').kind).toBe('reject')
  expect(classifyEntry('README.md').kind).toBe('reject')
})

// パストラバーサル。ZIP の項目名は書き手が自由に決められる
test('ディレクトリを跨ぐパスは reject', () => {
  expect(classifyEntry(`../notes/${ITEM_ID}.md`).kind).toBe('reject')
  expect(classifyEntry('notes/../../x.md').kind).toBe('reject')
  expect(classifyEntry(`/notes/${ITEM_ID}.md`).kind).toBe('reject')
  expect(classifyEntry('notes/sub/1042.md').kind).toBe('reject')
})

// 保存名の書式は配信 URL に組み立てる値。ZIP から来た文字列を信じない
test('添付の保存名が書式外なら reject', () => {
  expect(classifyEntry('images/evil.svg').kind).toBe('reject')
  expect(classifyEntry('images/../x.png').kind).toBe('reject')
})
