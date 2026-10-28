import { expect, test } from 'vitest'
import { isPlainClick, noteHintFromLink } from './noteHint'

const BASE = 'https://example.test/?q=x'

test('ノートへの行き先と題から、番号と題を作る', () => {
  expect(noteHintFromLink('/item/0199a?q=x', '回路のメモ', BASE)).toEqual({
    itemId: '0199a',
    title: '回路のメモ',
  })
})

test('題の無いリンクは拾わない', () => {
  expect(noteHintFromLink('/item/0199a', undefined, BASE)).toBeNull()
  expect(noteHintFromLink('/item/0199a', '', BASE)).toBeNull()
})

test('ノート以外への行き先は拾わない', () => {
  expect(noteHintFromLink('/trash', 'x', BASE)).toBeNull()
  // 履歴などの深い階層もノートの器には出ない
  expect(noteHintFromLink('/item/0199a/history', 'x', BASE)).toBeNull()
})

const PLAIN = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

// 新しいタブで開くときはこの画面が遷移しない
test('修飾キー付き・中ボタンのクリックは拾わない', () => {
  expect(isPlainClick(PLAIN)).toBe(true)
  expect(isPlainClick({ ...PLAIN, metaKey: true })).toBe(false)
  expect(isPlainClick({ ...PLAIN, ctrlKey: true })).toBe(false)
  expect(isPlainClick({ ...PLAIN, button: 1 })).toBe(false)
})
