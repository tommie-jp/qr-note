import { expect, test } from 'vitest'
import { cycleOf } from './cycle'

test('配列の並びどおりに次の値を引ける', () => {
  const next = cycleOf(['compact', 'card', 'image'])
  expect(next.compact).toBe('card')
  expect(next.card).toBe('image')
})

// 循環の最後の辺。ここが抜けていると、最後の値で押しても何も起きない
test('末尾の次は先頭に戻る', () => {
  const next = cycleOf(['compact', 'card', 'image'])
  expect(next.image).toBe('compact')
})

test('全部の値が鍵になる (押せない値を作らない)', () => {
  const values = ['updated', 'accessed', 'itemNo', 'title'] as const
  const next = cycleOf(values)
  expect(Object.keys(next).sort()).toEqual([...values].sort())
})

// 1 つしかない選択肢を押しても自分自身に戻るだけ (例外にしない)
test('要素が 1 つなら自分自身を指す', () => {
  expect(cycleOf(['only'])).toEqual({ only: 'only' })
})
