import { expect, test } from 'vitest'
import { extractTags } from '@/lib/markdown/tags/tags'
import { buildMemo, enexTagToMemoTag } from './buildMemo'

// --- タグの変換 ---

test('そのままタグにできる文字はそのまま (正規化のみ)', () => {
  expect(enexTagToMemoTag('電子工作')).toBe('電子工作')
  expect(enexTagToMemoTag('NPN')).toBe('npn')
  expect(enexTagToMemoTag('ＮＰＮ')).toBe('npn')
})

// Evernote のタグは空白や記号を含められるが、このアプリの #タグ は
// 文字・数字・`_`・`-` しか使えない (markdown/tags/tags.ts)。壊れた記法を書き込まないよう寄せる
test('タグに使えない文字は - に寄せる', () => {
  expect(enexTagToMemoTag('電子 工作')).toBe('電子-工作')
  expect(enexTagToMemoTag('部品/抵抗')).toBe('部品-抵抗')
})

test('前後の - は落とす', () => {
  expect(enexTagToMemoTag(' 抵抗 ')).toBe('抵抗')
  expect(enexTagToMemoTag('!!抵抗!!')).toBe('抵抗')
})

test('タグにならないものは null', () => {
  expect(enexTagToMemoTag('')).toBeNull()
  expect(enexTagToMemoTag('!!!')).toBeNull()
})

// --- memo の組み立て ---

test('題名・タグ行・本文をこの順に並べる', () => {
  expect(buildMemo('2SC1815 のストック', 'hFE=208', ['電子工作'])).toBe(
    '2SC1815 のストック\n\n#電子工作\n\nhFE=208',
  )
})

test('タグが無ければタグ行を作らない', () => {
  expect(buildMemo('題名', '本文', [])).toBe('題名\n\n本文')
})

test('題名が無いノートでも本文だけで組み立てる', () => {
  expect(buildMemo('', '本文', ['x'])).toBe('#x\n\n本文')
})

test('本文が無いノートでも題名だけで組み立てる', () => {
  expect(buildMemo('題名', '', [])).toBe('題名')
})

// 書き込んだタグを保存経路 (extractTags) が拾えなければ、タグ検索に出てこない。
// 書き手と読み手の解釈が一致していることをここで固定する
test('書き込んだタグは extractTags が拾える', () => {
  const memo = buildMemo('題名', '本文', ['電子工作', 'npn'])
  expect(extractTags(memo)).toEqual(['電子工作', 'npn'])
})

// 本文が ``` で始まると、タグ行が後ろにあるとコードフェンス内に落ちて拾えない。
// タグ行を本文より前に置いているのはこれを避けるため
test('本文がコードフェンスで始まってもタグは拾える', () => {
  const memo = buildMemo('題名', '```\ncode\n```', ['npn'])
  expect(extractTags(memo)).toEqual(['npn'])
})
