import { expect, test } from 'vitest'
import {
  baseOf,
  bySort,
  byTrashSort,
  isDescending,
  isReversed,
  reverseOf,
  SEARCH_SORT_SPEC,
  SORT_BASES,
  TRASH_SORT_BASES,
  TRASH_SORT_SPEC,
  trashBaseOf,
  trashIsDescending,
  trashReverseOf,
} from './sortDirection'
import { orderByClause } from './sortOrder'
import { parseSort, SORTS, TRASH_SORTS } from './validation'

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

// --- ゴミ箱 (docs/67-ゴミ箱表示形式計画.md §2) ---
//
// 増えたのは「削除順」の 1 対だけ。残りの 4 種別は検索一覧とまったく同じに
// 振る舞わなければならない (同じスロット部品が両方を描くため)

test('削除順も種別に畳まれ、他の種別は検索一覧と同じ', () => {
  expect(trashBaseOf('deleted')).toBe('deleted')
  expect(trashBaseOf('deletedAsc')).toBe('deleted')
  for (const sort of SORTS) {
    expect(trashBaseOf(sort)).toBe(baseOf(sort))
  }
})

test('trashReverseOf は方向だけを裏返し、2 回で元に戻る', () => {
  expect(trashReverseOf('deleted')).toBe('deletedAsc')
  expect(trashReverseOf('deletedAsc')).toBe('deleted')
  for (const sort of TRASH_SORTS) {
    expect(trashBaseOf(trashReverseOf(sort))).toBe(trashBaseOf(sort))
    expect(trashReverseOf(trashReverseOf(sort))).toBe(sort)
  }
})

// 削除順の既定は「新しく消した順」= 降順。更新順・アクセス順と同じ扱い
test('削除順の既定は降順', () => {
  expect(trashIsDescending('deleted')).toBe(true)
  expect(trashIsDescending('deletedAsc')).toBe(false)
})

// 画面の矢印と実際の並びが食い違うのがいちばん困る (上の検索側と同じ検査)
test('ゴミ箱でもアイコンの向きは ORDER BY の向きと一致する', () => {
  for (const sort of TRASH_SORTS) {
    const clause = orderByClause(sort)
    const keys = clause.slice(0, clause.lastIndexOf('item_no ASC'))
    expect(keys.includes(' DESC')).toBe(trashIsDescending(sort))
  }
})

test('byTrashSort は 10 値ぶんの表を作る', () => {
  const table = byTrashSort((sort) => trashBaseOf(sort))
  expect(Object.keys(table).sort()).toEqual([...TRASH_SORTS].sort())
  expect(table.deletedAsc).toBe('deleted')
})

// メニューは種別ぶんの行しか出さない。ゴミ箱は削除順が先頭 (既定なので、
// いちばん上に置く) で、残りは検索一覧と同じ並び
test('ゴミ箱の種別は削除順が先頭で、残りは検索一覧と同じ並び', () => {
  expect(TRASH_SORT_BASES).toEqual(['deleted', ...SORT_BASES])
})

// 下部バーの部品が引く一式。spec のどれか 1 つを取り違えると、
// メニューの印だけが現在行からずれる (画面では気づきにくい)
test('spec は自分の種別と関数の組で閉じている', () => {
  expect(SEARCH_SORT_SPEC.bases).toEqual(SORT_BASES)
  expect(SEARCH_SORT_SPEC.baseOf('updatedAsc')).toBe('updated')
  expect(TRASH_SORT_SPEC.bases).toEqual(TRASH_SORT_BASES)
  expect(TRASH_SORT_SPEC.baseOf('deletedAsc')).toBe('deleted')
  expect(TRASH_SORT_SPEC.isDescending('deleted')).toBe(true)
  expect(Object.keys(TRASH_SORT_SPEC.by((s) => s)).sort()).toEqual(
    [...TRASH_SORTS].sort(),
  )
})
