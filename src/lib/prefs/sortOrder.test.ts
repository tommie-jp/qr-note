import { expect, test } from 'vitest'
import { orderByClause } from './sortOrder'
import { TRASH_SORTS } from '../validation'

test('登録順は id 昇順 (UUID v7 なので作った順)', () => {
  expect(orderByClause('registered')).toBe('id ASC')
})

test('更新順は updated_at 降順', () => {
  expect(orderByClause('updated')).toBe('updated_at DESC, id ASC')
})

// 最近見た順 (docs/37-アクセス順計画.md)
test('アクセス順は accessed_at 降順', () => {
  expect(orderByClause('accessed')).toBe(
    'accessed_at DESC, updated_at DESC, id ASC',
  )
})

// 一覧の見出し順 (docs/63-タイトル順計画.md)。鍵は見出しの派生列 title
test('タイトル順は見出し昇順 (無題は末尾)', () => {
  expect(orderByClause('title')).toBe(
    "NULLIF(title, '') ASC NULLS LAST, id ASC",
  )
})

// 逆順 (docs/64-並び順逆順計画.md)。**方向を裏返すのは並べる鍵だけ**で、
// 末尾のタイブレーク (id ASC) はどちらの向きでも同じにする
test('更新順の逆順は updated_at 昇順 (古い順)', () => {
  expect(orderByClause('updatedAsc')).toBe('updated_at ASC, id ASC')
})

test('アクセス順の逆順は accessed_at 昇順 (長く見ていない順)', () => {
  expect(orderByClause('accessedAsc')).toBe(
    'accessed_at ASC, updated_at ASC, id ASC',
  )
})

test('登録順の逆順は id 降順 (新しい順)', () => {
  expect(orderByClause('registeredDesc')).toBe('id DESC')
})

// 見出しの無いノートも同じ理由で末尾のまま
test('タイトル順の逆順は見出し降順 (無題は末尾のまま)', () => {
  expect(orderByClause('titleDesc')).toBe(
    "NULLIF(title, '') DESC NULLS LAST, id ASC",
  )
})

// ゴミ箱だけの並び (docs/67-ゴミ箱表示形式計画.md §2)。既定は
// 「いま消したあれ」を戻しやすい降順
test('削除順は deleted_at 降順', () => {
  expect(orderByClause('deleted')).toBe('deleted_at DESC, id ASC')
})

test('削除順の逆順は deleted_at 昇順 (長く置いてある順)', () => {
  expect(orderByClause('deletedAsc')).toBe('deleted_at ASC, id ASC')
})

// 同時刻の行で並びが不定になると、ページ送りと前後ナビが読み込みのたびに
// 揺れる (docs/15 §2-2)。どの並びでも item_no で決着させる
test('どの並びも id で決着する', () => {
  for (const sort of TRASH_SORTS) {
    // 登録順 (逆順) は id そのものが並べる鍵なので、id で終われば足りる
    expect(orderByClause(sort)).toMatch(/\bid (ASC|DESC)$/)
  }
})

// Prisma.raw に渡すので、外から来た文字列が混ざらないことを型と実装で担保する。
// 万一 Sort 以外が来ても既定 (更新順) へ倒れ、SQL 片は生えない
test('知らない値でも SQL 片は生えない', () => {
  const clause = orderByClause('; DROP TABLE items --' as never)
  expect(clause).toBe('updated_at DESC, id ASC')
})
