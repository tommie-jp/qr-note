import { afterEach, describe, expect, test } from 'vitest'
import { isPublicItem, type PublicCheckable } from './publicItem'

const originalDemo = process.env.DEMO_MODE

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

// 日付そのものに意味はない。「非 null かどうか」だけを見る判定なので、
// 読み手が値に気を取られないよう固定値を 1 つ置く
const SOME_TIME = new Date('2026-07-17T00:00:00Z')

function item(overrides: Partial<PublicCheckable> = {}): PublicCheckable {
  return { publicAt: null, deletedAt: null, ...overrides }
}

describe('isPublicItem', () => {
  test('公開したノートは公開', () => {
    expect(isPublicItem(item({ publicAt: SOME_TIME }))).toBe(true)
  })

  test('公開していないノートは非公開 (既定)', () => {
    expect(isPublicItem(item())).toBe(false)
  })

  // 未登録の itemNo。呼び出し側は getItem() の null をそのまま渡せる
  test('未登録 (null) は非公開', () => {
    expect(isPublicItem(null)).toBe(false)
  })

  // docs/22 §3。/item はゴミ箱の行も持ち主には見せる (docs/12 §5) が、
  // 捨てたものが外から見え続けるほうが驚きが大きい
  test('ゴミ箱のノートは、公開済みでも公開しない', () => {
    expect(isPublicItem(item({ publicAt: SOME_TIME, deletedAt: SOME_TIME }))).toBe(false)
  })

  test('ゴミ箱かつ非公開も当然 非公開', () => {
    expect(isPublicItem(item({ deletedAt: SOME_TIME }))).toBe(false)
  })

  // docs/38-デモモード計画.md §3。デモでは公開の口をすべて閉じるので、
  // 公開済みの行でも未ログインには見せない (種に public_at が紛れても塞がる)
  test('デモモードでは公開済みでも非公開に倒す', () => {
    process.env.DEMO_MODE = '1'
    expect(isPublicItem(item({ publicAt: SOME_TIME }))).toBe(false)
  })
})
