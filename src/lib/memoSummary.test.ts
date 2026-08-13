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
  // 普通のコード (ノート表示でもテキストとして見える) は中身を要約に使う
  expect(memoSummary('```bash\nls -la\n```')).toBe('ls -la')
})

// 描画フェンス (circuitikz / mermaid / quiz) はノート表示で図やカードに化け、
// ソースはテキストとして見えない。TeX やグラフ記法を要約 (一覧のタイトル) に
// 出さない (docs/68 §7)
test('描画フェンスの中身は要約に使わない', () => {
  expect(memoSummary('```mermaid\ngraph TD;\n```\n散文の行')).toBe('散文の行')
  expect(memoSummary('```circuitikz\n\\draw (0,0);\n```\n回路メモ')).toBe(
    '回路メモ',
  )
})

test('描画フェンスしか無いメモの要約は空 (一覧側が「(空のノート)」を出す)', () => {
  expect(memoSummary('```circuitikz\n\\draw (0,0);\n```')).toBe('')
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

// インライン数式・ブロック数式 (docs/69-一覧数式計画.md)

test('タイトル内の数式の * を強調として剥がさない', () => {
  expect(memoSummary('$x^*$ と $y^*$ の関係')).toBe('$x^*$ と $y^*$ の関係')
})

test('ブロック数式で始まるメモのタイトルは次の散文行', () => {
  // $$ の行がタイトルになったり、中身の TeX がタイトルになったりしない
  expect(memoSummary('$$\nE = mc^2\n$$\n定常状態のメモ')).toBe('定常状態のメモ')
})

test('閉じていない $$ は残り全部を隠す (remark-math も末尾まで数式として描く)', () => {
  // ノート表示では「本文」も数式ブロックの中身として描かれるので、
  // 一覧でもテキスト扱いしない — 見え方をノートと揃える
  expect(memoSummary('$$\n本文')).toBe('')
})

// ページの区切り (docs/74-ページ計画.md §3)。水平線はページとページの境目で
// あって見出しではない — 飛ばさないと、区切りで始まるノートのタイトルが
// "---" になる。＋ で新しいページを足す操作がこれを日常にする
test('先頭の水平線を飛ばして次の行をタイトルにする', () => {
  expect(memoSummary('---\n\nうどん 関西')).toBe('うどん 関西')
  expect(memoSummary('***\n\nA')).toBe('A')
  expect(memoSummary('___\n\nA')).toBe('A')
})

// 段落の直後の罫線は CommonMark では setext 見出しの下線で、上の行が見出し。
// 既存ノートの大半 (表の罫線) がこの形なので回帰として固定する
test('罫線の上の行はタイトルになる', () => {
  expect(memoSummary('赤LED\n------\n点灯    充電中')).toBe('赤LED')
})

// 答え隠し (docs/79)。剥がして中身を残すのではなく、**中身ごと落とす** —
// 一覧のカードに訳が出ていたら隠した意味がない
test('答え隠しは中身ごと落とす', () => {
  expect(memoSummary('- [ ] infect ||動 ～に感染させる||')).toBe('infect')
})

test('答え隠しでない `||` は残す (表の空セル)', () => {
  expect(memoSummary('| a || b |')).toBe('| a || b |')
})
