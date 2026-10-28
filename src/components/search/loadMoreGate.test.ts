import { describe, expect, test } from 'vitest'
import { buildSearchUrl } from '@/lib/search/url'
import {
  SCROLL_ARM_DISTANCE_PX,
  canScroll,
  createScrollArm,
  searchKeyOf,
} from './loadMoreGate'

describe('createScrollArm', () => {
  test('動いていなければ解禁しない', () => {
    const arm = createScrollArm(0)

    expect(arm(0)).toBe(false)
  })

  test('下へ一定距離スクロールしたら解禁する', () => {
    const arm = createScrollArm(0)

    expect(arm(SCROLL_ARM_DISTANCE_PX - 1)).toBe(false)
    expect(arm(SCROLL_ARM_DISTANCE_PX)).toBe(true)
  })

  test('先頭へ戻す (上向きの) スクロールでは解禁しない', () => {
    // 新しい検索で一覧が先頭へ戻されたときのスクロールイベント
    const arm = createScrollArm(500)

    expect(arm(0)).toBe(false)
  })

  test('戻された位置から下へ動けば解禁する', () => {
    const arm = createScrollArm(500)

    arm(0)

    expect(arm(SCROLL_ARM_DISTANCE_PX)).toBe(true)
  })
})

describe('searchKeyOf', () => {
  test('ページ番号だけが違う URL は同じ検索', () => {
    expect(searchKeyOf(buildSearchUrl('抵抗', 2, 'updated'))).toBe(
      searchKeyOf(buildSearchUrl('抵抗', 3, 'updated')),
    )
  })

  test('検索語か並び順が違えば別の検索', () => {
    const base = searchKeyOf(buildSearchUrl('抵抗', 2, 'updated'))

    expect(searchKeyOf(buildSearchUrl('コンデンサ', 2, 'updated'))).not.toBe(base)
    expect(searchKeyOf(buildSearchUrl('抵抗', 2, 'titleDesc'))).not.toBe(base)
  })
})

describe('canScroll', () => {
  test('中身が器に収まっていればスクロールできない', () => {
    expect(canScroll(871, 871)).toBe(false)
  })

  test('1px の端数は収まっているとみなす', () => {
    expect(canScroll(872, 871)).toBe(false)
  })

  test('器より長ければスクロールできる', () => {
    expect(canScroll(1700, 871)).toBe(true)
  })
})
