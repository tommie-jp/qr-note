import { expect, test } from 'vitest'
import { resolveSort, resolveTrashSort } from './sortMode'

test('URL に指定があればそれを使う', () => {
  expect(resolveSort('accessed', undefined)).toBe('accessed')
  expect(resolveSort('itemNo', undefined)).toBe('itemNo')
})

// 共有されたリンクを開いた人に、自分の好みを混ぜて見せない
test('URL の指定は cookie より優先する', () => {
  expect(resolveSort('itemNo', 'accessed')).toBe('itemNo')
  expect(resolveSort('updated', 'accessed')).toBe('updated')
})

// ヘッダーの「QR search」・検索フォーム・スキャン・タグリンクから入る経路。
// ここで cookie を見るのがこの機能の目的
test('URL に指定が無ければ cookie を使う', () => {
  expect(resolveSort(undefined, 'accessed')).toBe('accessed')
  expect(resolveSort(null, 'itemNo')).toBe('itemNo')
})

test('どちらも無ければ更新順', () => {
  expect(resolveSort(undefined, undefined)).toBe('updated')
  expect(resolveSort(null, null)).toBe('updated')
})

// URL も cookie も利用者が自由に書き換えられる外部入力
test('知らない値は既定へ倒す', () => {
  expect(resolveSort('; DROP TABLE items', undefined)).toBe('updated')
  expect(resolveSort(undefined, 'nonsense')).toBe('updated')
  expect(resolveSort(undefined, { evil: true })).toBe('updated')
})

// 空文字は「指定なし」ではなく不正値として扱われるが、cookie へ倒れずに
// 既定になる。URL に ?sort= と書いた人の意図は「既定で見たい」なので自然
test('空の sort= は既定になる (cookie へは倒れない)', () => {
  expect(resolveSort('', 'accessed')).toBe('updated')
})

// --- ゴミ箱 (docs/67-ゴミ箱表示形式計画.md §2) ---

test('ゴミ箱も URL → cookie → 既定 の順で決まる', () => {
  expect(resolveTrashSort('itemNo', 'deletedAsc')).toBe('itemNo')
  expect(resolveTrashSort(undefined, 'deletedAsc')).toBe('deletedAsc')
  expect(resolveTrashSort(undefined, undefined)).toBe('deleted')
})

// /trash への入口 (検索結果の「ゴミ箱 (N)」・0 件案内・ノートのバナー) は
// どれも ?sort= を持たない。cookie が無いと開くたびに既定へ戻る
test('ゴミ箱の並びも cookie で覚える', () => {
  expect(resolveTrashSort(null, 'itemNo')).toBe('itemNo')
})

// **2 つの cookie を混ぜない。** 混ぜると、検索側は知らない値 (削除順) を
// 既定へ倒すので、ゴミ箱を開くたびに検索の並びが巻き戻る
test('検索側は削除順を受け取らない', () => {
  expect(resolveSort(undefined, 'deleted')).toBe('updated')
  expect(resolveTrashSort(undefined, 'deleted')).toBe('deleted')
})
