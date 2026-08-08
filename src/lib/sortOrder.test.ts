import { expect, test } from 'vitest'
import { orderByClause } from './sortOrder'

test('番号順は item_no_num 昇順 (非数字は末尾)', () => {
  expect(orderByClause('itemNo')).toBe('item_no_num ASC NULLS LAST, item_no ASC')
})

test('更新順は updated_at 降順', () => {
  expect(orderByClause('updated')).toBe('updated_at DESC, item_no ASC')
})

// 最近見た順 (docs/37-アクセス順計画.md)
test('アクセス順は accessed_at 降順', () => {
  expect(orderByClause('accessed')).toBe(
    'accessed_at DESC, updated_at DESC, item_no ASC',
  )
})

// 一覧の見出し順 (docs/63-タイトル順計画.md)。見出しは URL モードだけ url を
// 見るので、ItemRow と同じ切り分けを SQL 側でもする
test('タイトル順は見出し昇順 (無題は末尾)', () => {
  expect(orderByClause('title')).toBe(
    "NULLIF(CASE WHEN mode = 'url' THEN url ELSE title END, '') ASC NULLS LAST, item_no ASC",
  )
})

// 同時刻の行で並びが不定になると、ページ送りと前後ナビが読み込みのたびに
// 揺れる (docs/15 §2-2)。どの並びでも item_no で決着させる
test('どの並びも item_no でタイブレークする', () => {
  for (const sort of ['itemNo', 'updated', 'accessed', 'title'] as const) {
    expect(orderByClause(sort)).toMatch(/item_no ASC$/)
  }
})

// Prisma.raw に渡すので、外から来た文字列が混ざらないことを型と実装で担保する。
// 万一 Sort 以外が来ても既定 (更新順) へ倒れ、SQL 片は生えない
test('知らない値でも SQL 片は生えない', () => {
  const clause = orderByClause('; DROP TABLE items --' as never)
  expect(clause).toBe('updated_at DESC, item_no ASC')
})
