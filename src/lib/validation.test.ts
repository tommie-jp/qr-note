import { describe, expect, test } from 'vitest'
import {
  buildItemUrl,
  escapeLike,
  isLegacyItemNo,
  isValidItemId,
  parseSort,
  parseTrashSort,
  SORTS,
} from './validation'

const ID = '0192f5e8-7a3b-7c4d-8e5f-0123456789ab'

describe('isValidItemId', () => {
  test('accepts a lowercase UUID v7', () => {
    expect(isValidItemId(ID)).toBe(true)
  })

  test('rejects uppercase UUID (URL を 1 つに保つ)', () => {
    expect(isValidItemId(ID.toUpperCase())).toBe(false)
  })

  test('rejects legacy numbers like "1003" and "100x"', () => {
    expect(isValidItemId('1003')).toBe(false)
    expect(isValidItemId('100x')).toBe(false)
    expect(isValidItemId('1')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isValidItemId('')).toBe(false)
  })

  test('rejects UUID without hyphens or with extra characters', () => {
    expect(isValidItemId(ID.replace(/-/g, ''))).toBe(false)
    expect(isValidItemId(`${ID}0`)).toBe(false)
    expect(isValidItemId(` ${ID}`)).toBe(false)
    expect(isValidItemId(`{${ID}}`)).toBe(false)
  })

  test('rejects path traversal and separators', () => {
    expect(isValidItemId('../etc')).toBe(false)
    expect(isValidItemId('a/b')).toBe(false)
  })
})

describe('isLegacyItemNo', () => {
  test('accepts Ver1 numbers and workbook ids', () => {
    expect(isLegacyItemNo('1003')).toBe(true)
    expect(isLegacyItemNo('100x')).toBe(true)
    expect(isLegacyItemNo('1')).toBe(true)
    expect(isLegacyItemNo('wb01-03-08')).toBe(true)
    expect(isLegacyItemNo('a_b')).toBe(true)
  })

  test('rejects UUIDs (新しい識別子は旧番号ではない)', () => {
    expect(isLegacyItemNo(ID)).toBe(false)
  })

  test('rejects empty string and strings longer than 20 chars', () => {
    expect(isLegacyItemNo('')).toBe(false)
    expect(isLegacyItemNo('1'.repeat(20))).toBe(true)
    expect(isLegacyItemNo('1'.repeat(21))).toBe(false)
  })

  test('rejects path traversal, separators and whitespace', () => {
    expect(isLegacyItemNo('../etc')).toBe(false)
    expect(isLegacyItemNo('a/b')).toBe(false)
    expect(isLegacyItemNo('10 03')).toBe(false)
  })
})

describe('escapeLike', () => {
  test('escapes percent and underscore', () => {
    expect(escapeLike('100_')).toBe('100\\_')
    expect(escapeLike('50%')).toBe('50\\%')
  })

  test('escapes backslash itself', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b')
  })

  test('leaves plain text unchanged', () => {
    expect(escapeLike('抵抗 10k')).toBe('抵抗 10k')
  })
})

describe('parseSort', () => {
  test('returns "registered" for "registered"', () => {
    expect(parseSort('registered')).toBe('registered')
  })

  // 番号順は登録順になった (docs/107 §4-6)。旧い名前は cookie・共有 URL・
  // 本文のリンクに残っているので、読むときに新しい名前へ寄せる
  test('reads legacy "itemNo" / "itemNoDesc" as registered / registeredDesc', () => {
    expect(parseSort('itemNo')).toBe('registered')
    expect(parseSort('itemNoDesc')).toBe('registeredDesc')
  })

  test('does not treat Object.prototype keys as legacy names', () => {
    expect(parseSort('constructor')).toBe('updated')
    expect(parseSort('toString')).toBe('updated')
  })

  // 最近見た順 (docs/37-アクセス順計画.md)
  test('returns "accessed" for "accessed"', () => {
    expect(parseSort('accessed')).toBe('accessed')
  })

  // 一覧の見出し順 (docs/63-タイトル順計画.md)
  test('returns "title" for "title"', () => {
    expect(parseSort('title')).toBe('title')
  })

  // 逆順は種別ごとに別の値として持つ (docs/64-並び順逆順計画.md §2)。
  // 基底の 4 値の意味は変えないので、前に選んだ cookie も共有 URL も
  // そのままの並びで開く
  test('returns the reversed sorts as-is', () => {
    expect(parseSort('updatedAsc')).toBe('updatedAsc')
    expect(parseSort('accessedAsc')).toBe('accessedAsc')
    expect(parseSort('registeredDesc')).toBe('registeredDesc')
    expect(parseSort('titleDesc')).toBe('titleDesc')
  })

  test('defaults to "updated" for undefined or unknown values', () => {
    expect(parseSort(undefined)).toBe('updated')
    expect(parseSort('other')).toBe('updated')
    expect(parseSort(null)).toBe('updated')
    // 方向だけの値は並びを決められないので既定へ倒す
    expect(parseSort('asc')).toBe('updated')
    expect(parseSort('updatedDesc')).toBe('updated')
  })
})

// ゴミ箱だけの並び (docs/67-ゴミ箱表示形式計画.md §2)
describe('parseTrashSort', () => {
  test('削除順とその逆順をそのまま通す', () => {
    expect(parseTrashSort('deleted')).toBe('deleted')
    expect(parseTrashSort('deletedAsc')).toBe('deletedAsc')
  })

  // ゴミ箱でも「更新順で消し忘れを探す」「登録順で古いものから見る」は要る
  test('検索一覧と同じ並びもそのまま通す', () => {
    for (const sort of SORTS) {
      expect(parseTrashSort(sort)).toBe(sort)
    }
  })

  test('旧名 itemNo / itemNoDesc は登録順へ読み替える', () => {
    expect(parseTrashSort('itemNo')).toBe('registered')
    expect(parseTrashSort('itemNoDesc')).toBe('registeredDesc')
  })

  test('知らない値は削除順へ倒す (ゴミ箱の既定)', () => {
    expect(parseTrashSort(undefined)).toBe('deleted')
    expect(parseTrashSort('other')).toBe('deleted')
    expect(parseTrashSort('; DROP TABLE items')).toBe('deleted')
  })

  // **検索側は削除順を知らない。** deleted_at は検索一覧では必ず null なので、
  // `/?sort=deleted` は意味のない並びになる。型を分けた効果をここで固定する
  test('削除順は検索側の parseSort では既定へ倒れる', () => {
    expect(parseSort('deleted')).toBe('updated')
    expect(parseSort('deletedAsc')).toBe('updated')
  })
})

describe('buildItemUrl', () => {
  test('builds the QR target URL', () => {
    expect(buildItemUrl('https://qr.tommie.jp', ID)).toBe(
      `https://qr.tommie.jp/item/${ID}`,
    )
  })

  test('tolerates trailing slash in base URL', () => {
    expect(buildItemUrl('https://qr.tommie.jp/', ID)).toBe(
      `https://qr.tommie.jp/item/${ID}`,
    )
  })
})
