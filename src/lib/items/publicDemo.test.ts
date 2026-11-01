import { afterEach, describe, expect, test, vi } from 'vitest'

// デモでは公開機能ごと閉じる (docs/38 §3) が、未ログインの添付配信と旧番号の
// 引き直しは isPublicItem() を通らず、この 2 関数が自前で SQL を引く。
// 2026-11 の監査 M-4: どちらも isDemoMode() を見ていなかった。
// DB には触らせない (デモなら SQL を発行する前に閉じることを見る)
const queryRaw = vi.fn(async () => [])
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: queryRaw } }))

const { isPublicImageName } = await import('./read')
const { findItemIdsByLegacyNo } = await import('./resolve')

afterEach(() => {
  vi.unstubAllEnvs()
  queryRaw.mockClear()
})

describe('デモの公開閉鎖', () => {
  test('isPublicImageName はデモでは SQL を引かずに false', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    expect(await isPublicImageName('0f6f3d6e-5a1b-7c2d-8e9f-0a1b2c3d4e5f.png')).toBe(false)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  test('isPublicImageName は本番では公開ノートを引く', async () => {
    await isPublicImageName('0f6f3d6e-5a1b-7c2d-8e9f-0a1b2c3d4e5f.png')
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })

  test('findItemIdsByLegacyNo の publicOnly はデモでは空 (id を教えない)', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    expect(await findItemIdsByLegacyNo('1003', { publicOnly: true })).toEqual([])
    expect(queryRaw).not.toHaveBeenCalled()
  })

  test('findItemIdsByLegacyNo はログイン済み (publicOnly でない) ならデモでも引く', async () => {
    vi.stubEnv('DEMO_MODE', '1')
    await findItemIdsByLegacyNo('1003', {})
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })
})
