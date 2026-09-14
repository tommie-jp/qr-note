import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// demoQuota は @/lib/db (prisma) と @/lib/images/imageStore (SUM) を引く。どちらも
// 差し替えて、判定の分岐だけを実 DB なしで確かめる。値はテストから制御する
const mocks = vi.hoisted(() => ({
  existingItem: null as { itemNo: string } | null,
  itemCount: 0,
  totalBytes: 0,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    item: {
      findUnique: async () => mocks.existingItem,
      count: async () => mocks.itemCount,
    },
  },
}))

vi.mock('@/lib/images/imageStore', () => ({
  totalAttachmentBytes: async () => mocks.totalBytes,
}))

import { assertDemoItemQuota, checkDemoUploadQuota } from './demoQuota'
import { DEMO_MAX_ITEMS, DEMO_MAX_TOTAL_UPLOAD_BYTES } from './demoLimits'

const originalDemo = process.env.DEMO_MODE

beforeEach(() => {
  mocks.existingItem = null
  mocks.itemCount = 0
  mocks.totalBytes = 0
})

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
})

describe('checkDemoUploadQuota', () => {
  test('デモでなければ、総量に関わらず null (クォータを掛けない)', async () => {
    delete process.env.DEMO_MODE
    mocks.totalBytes = DEMO_MAX_TOTAL_UPLOAD_BYTES * 10
    expect(await checkDemoUploadQuota(1)).toBeNull()
  })

  test('デモで総量が上限を超えるなら 507', async () => {
    process.env.DEMO_MODE = '1'
    mocks.totalBytes = DEMO_MAX_TOTAL_UPLOAD_BYTES
    const rejection = await checkDemoUploadQuota(1)
    expect(rejection?.status).toBe(507)
    expect(rejection?.error).toBeTruthy()
  })

  test('デモでも余裕があれば null', async () => {
    process.env.DEMO_MODE = '1'
    mocks.totalBytes = 0
    expect(await checkDemoUploadQuota(1024)).toBeNull()
  })
})

describe('assertDemoItemQuota', () => {
  test('デモでなければ、件数に関わらず投げない', async () => {
    delete process.env.DEMO_MODE
    mocks.existingItem = null
    mocks.itemCount = DEMO_MAX_ITEMS * 10
    await expect(assertDemoItemQuota('9999')).resolves.toBeUndefined()
  })

  test('デモで新規かつ上限に達していれば投げる', async () => {
    process.env.DEMO_MODE = '1'
    mocks.existingItem = null // 新規
    mocks.itemCount = DEMO_MAX_ITEMS
    await expect(assertDemoItemQuota('9999')).rejects.toThrow()
  })

  test('デモでも既存ノートの更新は、件数に関わらず通す', async () => {
    process.env.DEMO_MODE = '1'
    mocks.existingItem = { itemNo: '1' } // 既存
    mocks.itemCount = DEMO_MAX_ITEMS * 10
    await expect(assertDemoItemQuota('1')).resolves.toBeUndefined()
  })

  test('デモで新規でも上限未満なら通す', async () => {
    process.env.DEMO_MODE = '1'
    mocks.existingItem = null
    mocks.itemCount = DEMO_MAX_ITEMS - 1
    await expect(assertDemoItemQuota('9999')).resolves.toBeUndefined()
  })
})
