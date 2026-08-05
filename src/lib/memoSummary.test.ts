import { expect, test } from 'vitest'
import { memoSummary } from './memoSummary'

test('プレーンテキストは先頭行をそのまま返す', () => {
  expect(memoSummary('USB充電器 65W JACESS\n\nOutput:\n5V - 3A')).toBe(
    'USB充電器 65W JACESS',
  )
})

test('見出し記法を除去する', () => {
  expect(memoSummary('# タイトル\n本文')).toBe('タイトル')
})

test('リスト記法を除去する', () => {
  expect(memoSummary('- 項目1\n- 項目2')).toBe('項目1')
  expect(memoSummary('1. 項目1')).toBe('項目1')
})

test('チェックボックス記法を除去する', () => {
  expect(memoSummary('- [x] 完了タスク')).toBe('完了タスク')
})

test('強調・インラインコードの記号を除去する', () => {
  expect(memoSummary('**太字** と `code` と ~~取消~~')).toBe('太字 と code と 取消')
})

test('リンク・画像はテキストだけ残す', () => {
  expect(memoSummary('[説明](https://example.com)')).toBe('説明')
  expect(memoSummary('![代替テキスト](/img.png)')).toBe('代替テキスト')
})

test('コードフェンスの区切り行はスキップする', () => {
  expect(memoSummary('```mermaid\ngraph TD;\n```')).toBe('graph TD;')
})

test('先頭の空行・引用記法を飛ばす', () => {
  expect(memoSummary('\n\n> 引用文')).toBe('引用文')
})

// アラート (docs/54-markdown表示拡張計画.md §2)。目印は表示では枠と
// アイコンに化けるので、一覧に "[!NOTE]" の文字を出さない
test('アラートの目印を除去する', () => {
  expect(memoSummary('> [!NOTE]\n> 補足です')).toBe('補足です')
  expect(memoSummary('> [!WARNING] 火傷に注意')).toBe('火傷に注意')
})

// 表示側と同じ語彙を使う (src/lib/markdownAlerts.ts)。知らない種類まで
// 剥がすと、詳細画面には [!FOO] と出るのに要約からは消える
test('知らない種類の目印は本文として残す', () => {
  expect(memoSummary('> [!FOO] 本文')).toBe('[!FOO] 本文')
})

// 折りたたみ (docs/54 §4)。囲いの行は飛ばすが、ラベルは書き手が付けた
// 見出しなので要約に使う (飛ばすと隠したはずの中身が要約になる)
test('折りたたみのラベルを要約に使う', () => {
  expect(memoSummary(':::details[長いログ]\n本文\n:::')).toBe('長いログ')
})

test('ラベルのない折りたたみの区切り行はスキップする', () => {
  expect(memoSummary(':::details\n本文\n:::')).toBe('本文')
})

// 脚注 (docs/54 §3)。参照の番号と定義の目印は記号なので出さない
test('脚注の記法を除去する', () => {
  expect(memoSummary('本文です[^1]')).toBe('本文です')
  expect(memoSummary('[^1]: 出典のメモ')).toBe('出典のメモ')
})

test('部品名のアンダースコアはそのまま残す', () => {
  expect(memoSummary('ABC_DEF_100x')).toBe('ABC_DEF_100x')
})

test('空メモは空文字を返す', () => {
  expect(memoSummary('')).toBe('')
  expect(memoSummary('\n  \n')).toBe('')
})
