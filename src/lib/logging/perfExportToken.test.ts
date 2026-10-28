import { beforeEach, describe, expect, test, vi } from 'vitest'

// 計測ログの取得鍵 (docs/120 §3)。user_settings を Map で差し替える
const store = vi.hoisted(() => new Map<string, string>())

vi.mock('@/lib/prefs/userSettingStore', () => ({
  writeUserSetting: async (user: string, key: string, value: string) => {
    store.set(`${user}\n${key}`, value)
  },
  findUserSettingOwner: async (key: string, value: string) => {
    for (const [k, v] of store) {
      const [user, storedKey] = k.split('\n')
      if (storedKey === key && v === value) return user
    }
    return null
  },
}))

const { PERF_EXPORT_TOKEN_KEY, issuePerfExportToken, perfExportOwner } = await import(
  './perfExportToken'
)

beforeEach(() => store.clear())

describe('issuePerfExportToken', () => {
  test('鍵そのものではなく hash だけを保存する', async () => {
    const token = await issuePerfExportToken('tommie')

    const saved = store.get(`tommie\n${PERF_EXPORT_TOKEN_KEY}`)
    expect(saved).toMatch(/^[0-9a-f]{64}$/)
    expect(saved).not.toContain(token)
  })

  test('発行するたびに違う鍵になる', async () => {
    const first = await issuePerfExportToken('tommie')
    const second = await issuePerfExportToken('tommie')

    expect(second).not.toBe(first)
  })
})

describe('perfExportOwner', () => {
  test('発行した鍵で持ち主が分かる', async () => {
    const token = await issuePerfExportToken('tommie')

    expect(await perfExportOwner(token)).toBe('tommie')
  })

  test('発行し直すと前の鍵は使えない', async () => {
    const old = await issuePerfExportToken('tommie')
    await issuePerfExportToken('tommie')

    expect(await perfExportOwner(old)).toBeNull()
  })

  test.each(['', 'short', 'x'.repeat(44), 'a b'.repeat(15)])('形の違う鍵は DB を引かずに断る (%s)', async (token) => {
    expect(await perfExportOwner(token)).toBeNull()
  })
})

test('形は合っていても発行していない鍵は null', async () => {
  expect(await perfExportOwner('x'.repeat(43))).toBeNull()
})
