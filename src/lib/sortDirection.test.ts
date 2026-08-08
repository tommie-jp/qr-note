import { expect, test } from 'vitest'
import { baseOf, bySort, isDescending, isReversed, reverseOf } from './sortDirection'
import { orderByClause } from './sortOrder'
import { parseSort, SORTS } from './validation'

// 並び順は「種別 4 つ × 方向 2 つ」を 1 本の文字列で持つ
// (docs/64-並び順逆順計画.md §2)。基底の 4 値は**その種別の既定の方向**を指し、
// 既存の cookie と共有 URL の意味が変わらないようにしてある
test('基底の 4 値は自分自身が種別', () => {
  expect(baseOf('updated')).toBe('updated')
  expect(baseOf('accessed')).toBe('accessed')
  expect(baseOf('itemNo')).toBe('itemNo')
  expect(baseOf('title')).toBe('title')
})

test('逆順の値も同じ種別に畳まれる', () => {
  expect(baseOf('updatedAsc')).toBe('updated')
  expect(baseOf('accessedAsc')).toBe('accessed')
  expect(baseOf('itemNoDesc')).toBe('itemNo')
  expect(baseOf('titleDesc')).toBe('title')
})

// 日時は「新しい順」が既定、番号とタイトルは「小さい順・昇順」が既定。
// どちらも**既定を選び直したときに戻る先**なので、基底 = 逆順ではない側
test('日時の既定は降順、番号とタイトルの既定は昇順', () => {
  expect(isReversed('updated')).toBe(false)
  expect(isReversed('accessed')).toBe(false)
  expect(isReversed('itemNo')).toBe(false)
  expect(isReversed('title')).toBe(false)
  for (const sort of ['updatedAsc', 'accessedAsc', 'itemNoDesc', 'titleDesc'] as const) {
    expect(isReversed(sort)).toBe(true)
  }
})

// メニューの現在行をもう一度押したときに送る値。押すたびに往復するので、
// 2 回押せば元に戻る (docs/64 §3)
test('reverseOf は方向だけを裏返し、2 回で元に戻る', () => {
  expect(reverseOf('updated')).toBe('updatedAsc')
  expect(reverseOf('updatedAsc')).toBe('updated')
  for (const sort of SORTS) {
    expect(baseOf(reverseOf(sort))).toBe(baseOf(sort))
    expect(isReversed(reverseOf(sort))).toBe(!isReversed(sort))
    expect(reverseOf(reverseOf(sort))).toBe(sort)
  }
})

// 逆順の値も cookie と URL をそのまま通る。ここが通らないと、
// 逆順にした直後の再読み込みで既定へ落ちる
test('逆順の値も parseSort を素通りする', () => {
  for (const sort of SORTS) {
    expect(parseSort(sort)).toBe(sort)
  }
})

// バーのアイコンの向き。**既定の向きは種別で違う** ので、逆順かどうかだけでは
// 決まらない (日時は新しい順 = 降順が既定、番号とタイトルは昇順が既定)
test('日時の既定は降順、番号とタイトルの既定は昇順のアイコンになる', () => {
  expect(isDescending('updated')).toBe(true)
  expect(isDescending('updatedAsc')).toBe(false)
  expect(isDescending('itemNo')).toBe(false)
  expect(isDescending('itemNoDesc')).toBe(true)
})

// 画面の矢印と実際の並びが食い違うのがいちばん困る。並べる鍵 (末尾の
// タイブレークを除いた前半) の向きと突き合わせて、両方を一度に守る
test('アイコンの向きは ORDER BY の向きと一致する', () => {
  for (const sort of SORTS) {
    const clause = orderByClause(sort)
    const keys = clause.slice(0, clause.lastIndexOf('item_no ASC'))
    expect(keys.includes(' DESC')).toBe(isDescending(sort))
  }
})

// CycleSlot は「妥当な値をすべて並べた表」で送信値を畳むので、
// 表には 8 値すべてが要る (欠けるとその値が current に倒れて表示が古いまま)
test('bySort は 8 値ぶんの表を作る', () => {
  const table = bySort((sort) => baseOf(sort))
  expect(Object.keys(table).sort()).toEqual([...SORTS].sort())
  expect(table.updatedAsc).toBe('updated')
})
