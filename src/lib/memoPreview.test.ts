import { expect, test } from 'vitest'
import { memoPreview, MEMO_PREVIEW_MAX_LENGTH } from './memoPreview'

test('1 行目 (タイトル) を除いた本文を返す', () => {
  // 1 行目は memoSummary がタイトルとして出すので、本文で繰り返さない
  expect(memoPreview('USB充電器 65W\n出力は 5V 3A')).toBe('出力は 5V 3A')
})

test('複数行は空白で連結する', () => {
  // 表示は line-clamp で 3 行に収める。ここで行数を数えないのは、Markdown 上の
  // 1 行が画面では折り返して 2 行になるため (行の数え方は CSS の仕事)
  expect(memoPreview('タイトル\n一行目\n二行目\n三行目')).toBe(
    '一行目 二行目 三行目',
  )
})

test('空行は詰める', () => {
  expect(memoPreview('タイトル\n\n\n本文')).toBe('本文')
})

test('ハッシュだけの行は除く (2 行目のタグ表示と重複する)', () => {
  expect(memoPreview('タイトル\n#bjt #npn\n本文')).toBe('本文')
})

test('散文に混じったハッシュは残す (行全体がタグのときだけ落とす)', () => {
  expect(memoPreview('タイトル\nこれは #npn のトランジスタ')).toBe(
    'これは #npn のトランジスタ',
  )
})

test('key=value 行は除く (特性表に出るので重複する)', () => {
  expect(memoPreview('2SC1815\nhFE=208 Vf=700mV\n汎用の小信号用')).toBe(
    '汎用の小信号用',
  )
})

test('散文に混じった key=value は残す (行全体が key=value のときだけ落とす)', () => {
  // props.ts の「行全体が key=value」判定と同じ線引き
  expect(memoPreview('2SC1815\n実測では hFE=195 だった')).toBe(
    '実測では hFE=195 だった',
  )
})

test('画像は除く (サムネとして右端に出るので重複する)', () => {
  expect(memoPreview('書名\n![書影|120](/api/images/x.jpg)\n著者名')).toBe(
    '著者名',
  )
})

test('行に混じった画像はその部分だけ落とす', () => {
  expect(memoPreview('タイトル\n左 ![alt](/api/images/x.jpg) 右')).toBe('左 右')
})

test('Markdown の行頭記法を剥がす', () => {
  expect(memoPreview('タイトル\n- 項目1\n- 項目2')).toBe('項目1 項目2')
  expect(memoPreview('タイトル\n## 見出し')).toBe('見出し')
  expect(memoPreview('タイトル\n> 引用')).toBe('引用')
})

test('Markdown のインライン記法を剥がす', () => {
  expect(memoPreview('タイトル\n**太字** と `code` と [リンク](https://e.com)')).toBe(
    '太字 と code と リンク',
  )
})

test('長い本文は打ち切って … を付ける', () => {
  const long = `タイトル\n${'あ'.repeat(MEMO_PREVIEW_MAX_LENGTH + 50)}`

  const preview = memoPreview(long)

  expect(preview.length).toBe(MEMO_PREVIEW_MAX_LENGTH + 1)
  expect(preview.endsWith('…')).toBe(true)
})

test('収まる本文には … を付けない', () => {
  expect(memoPreview('タイトル\n短い本文')).toBe('短い本文')
})

// 折りたたみ・アラートの目印は表示では枠に化けるので、プレビューには出さない。
// ただしラベルは書き手が付けた見出しなので残す (docs/54-markdown表示拡張計画.md)
test('折りたたみの囲いを落としてラベルは残す', () => {
  expect(memoPreview('タイトル\n\n:::details[ログ]\n畳んだ中身\n:::')).toBe(
    'ログ 畳んだ中身',
  )
})

test('ラベルのない折りたたみは囲いだけ落とす', () => {
  expect(memoPreview('タイトル\n\n:::details\n畳んだ中身\n:::')).toBe(
    '畳んだ中身',
  )
})

test('アラートの目印を落とす', () => {
  expect(memoPreview('タイトル\n\n> [!NOTE]\n> 補足です')).toBe('補足です')
})

test('本文が無ければ空文字を返す', () => {
  expect(memoPreview('タイトルだけ')).toBe('')
  expect(memoPreview('')).toBe('')
  expect(memoPreview('タイトル\n#tag\nhFE=208')).toBe('')
})
