import { describe, expect, test } from 'vitest'
import {
  DEMO_MAX_ITEMS,
  DEMO_MAX_TOTAL_UPLOAD_BYTES,
  exceedsItemQuota,
  exceedsUploadQuota,
} from './demoLimits'

// docs/39-デモ公開計画.md §2。境界 (超過/未満/ちょうど) を固める純関数
describe('exceedsUploadQuota', () => {
  test('合計 + incoming が上限を超えたら true', () => {
    expect(exceedsUploadQuota(DEMO_MAX_TOTAL_UPLOAD_BYTES, 1)).toBe(true)
  })

  test('ちょうど上限に収まるなら false (上限ぴったりまで受ける)', () => {
    expect(exceedsUploadQuota(DEMO_MAX_TOTAL_UPLOAD_BYTES - 100, 100)).toBe(false)
  })

  test('上限に余裕があれば false', () => {
    expect(exceedsUploadQuota(0, 1024)).toBe(false)
  })
})

describe('exceedsItemQuota', () => {
  test('現在数が上限以上なら新規は作れない (true)', () => {
    expect(exceedsItemQuota(DEMO_MAX_ITEMS)).toBe(true)
    expect(exceedsItemQuota(DEMO_MAX_ITEMS + 1)).toBe(true)
  })

  test('上限より少なければ作れる (false)', () => {
    expect(exceedsItemQuota(DEMO_MAX_ITEMS - 1)).toBe(false)
    expect(exceedsItemQuota(0)).toBe(false)
  })
})
