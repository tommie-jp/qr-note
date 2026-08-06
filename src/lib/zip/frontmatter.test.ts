import { expect, test } from 'vitest'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'

test('key: value の並びを --- で挟んで書く', () => {
  const text = serializeFrontmatter([
    ['itemNo', { quoted: '1042' }],
    ['mode', { bare: 'memo' }],
  ])
  expect(text).toBe('---\nitemNo: "1042"\nmode: memo\n---\n')
})

// 引用符付きは JSON の書き方 (YAML 1.2 の二重引用スカラーと同じ) にする。
// url は利用者が自由に書ける文字列なので、素で置くと壊れる
test('引用符付きの値は JSON と同じ書き方で逃がす', () => {
  const text = serializeFrontmatter([['url', { quoted: 'a"b\\c\nd' }]])
  expect(text).toBe('---\nurl: "a\\"b\\\\c\\nd"\n---\n')
})

test('読むと key/value と本文に分かれる', () => {
  const parsed = parseFrontmatter('---\nitemNo: "1042"\nmode: memo\n---\n本文\n')
  expect(parsed?.fields.get('itemNo')).toBe('1042')
  expect(parsed?.fields.get('mode')).toBe('memo')
  expect(parsed?.body).toBe('本文\n')
})

// 往復して元に戻ること。エクスポートとインポートで解釈がずれると、
// 書き出したファイルを戻せない
test('書いて読むと元の値に戻る', () => {
  const url = 'https://example.com/?q="a b"\\c'
  const text = serializeFrontmatter([['url', { quoted: url }]])
  expect(parseFrontmatter(text)?.fields.get('url')).toBe(url)
})

test('引用符なしの値もそのまま読む (手書きの Markdown 用)', () => {
  const parsed = parseFrontmatter('---\nitemNo: 1042\npublic: false\n---\n')
  expect(parsed?.fields.get('itemNo')).toBe('1042')
  expect(parsed?.fields.get('public')).toBe('false')
})

test('値に : を含んでも最初の : だけで区切る', () => {
  const parsed = parseFrontmatter('---\ncreated: 2025-11-02T10:30:00Z\n---\n')
  expect(parsed?.fields.get('created')).toBe('2025-11-02T10:30:00Z')
})

test('CRLF の改行でも読める', () => {
  const parsed = parseFrontmatter('---\r\nmode: memo\r\n---\r\n本文\r\n')
  expect(parsed?.fields.get('mode')).toBe('memo')
  expect(parsed?.body).toBe('本文\r\n')
})

test('空行とコメント行は読み飛ばす', () => {
  const parsed = parseFrontmatter('---\n\n# メモ\nmode: memo\n---\n')
  expect(parsed?.fields.get('mode')).toBe('memo')
})

test('frontmatter が無ければ null', () => {
  expect(parseFrontmatter('本文だけ\n')).toBeNull()
  // 閉じの --- が無いものは frontmatter として読めない
  expect(parseFrontmatter('---\nmode: memo\n')).toBeNull()
})

// 壊れた引用符を黙って素通しすると、url に引用符ごと入って往復が壊れる
test('引用符の開きだけがある値は null (ファイルごと断る)', () => {
  expect(parseFrontmatter('---\nurl: "閉じない\n---\n')).toBeNull()
})

test('本文が空でも読める', () => {
  const parsed = parseFrontmatter('---\nmode: memo\n---\n')
  expect(parsed?.body).toBe('')
})
