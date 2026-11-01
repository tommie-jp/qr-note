import { beforeEach, describe, expect, test, vi } from 'vitest'

// 計測ログの取得鍵 (docs/120 §3)。user_settings を Map で差し替える
const store = vi.hoisted(() => new Map<string, string>())

vi.mock('@/lib/prefs/userSettingStore', () => ({
  writeUserSetting: async (user: string, key: string, value: string) => {
    store.set(`${user}\n${key}`, value)
  },
  readUserSetting: async (user: string, key: string) => store.get(`${user}\n${key}`) ?? null,
  findUserSettingOwner: async (key: string, value: string) => {
    for (const [k, v] of store) {
      const [user, storedKey] = k.split('\n')
      if (storedKey === key && v === value) return user
    }
    return null
  },
}))

const {
  DEPLOY_TOKEN_OWNER,
  PERF_EXPORT_TOKEN_ISSUED_KEY,
  PERF_EXPORT_TOKEN_KEY,
  PERF_EXPORT_TOKEN_TTL_MS,
  issuePerfExportToken,
  newPerfExportToken,
  perfExportOwner,
  registerPerfExportToken,
} = await import('./perfExportToken')

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

describe('registerPerfExportToken (配布スクリプトが揃える鍵)', () => {
  test('手元で作った鍵を登録すると、その鍵で通る', async () => {
    const token = newPerfExportToken()

    await registerPerfExportToken(DEPLOY_TOKEN_OWNER, token)

    expect(await perfExportOwner(token)).toBe(DEPLOY_TOKEN_OWNER)
  })

  test('画面から発行し直しても、配布の鍵は使えるまま', async () => {
    const deployToken = newPerfExportToken()
    await registerPerfExportToken(DEPLOY_TOKEN_OWNER, deployToken)

    await issuePerfExportToken('tommie')

    expect(await perfExportOwner(deployToken)).toBe(DEPLOY_TOKEN_OWNER)
  })

  test('形の違う鍵は登録しない', async () => {
    await expect(registerPerfExportToken(DEPLOY_TOKEN_OWNER, 'short')).rejects.toThrow()
    expect(store.size).toBe(0)
  })
})

// 寿命 (2026-11 の監査 LOW)
describe('寿命', () => {
  test('発行から 30 日を過ぎた鍵は使えない', async () => {
    const token = await issuePerfExportToken('tommie')
    const issued = new Date('2026-11-01T00:00:00.000Z')
    store.set(`tommie\n${PERF_EXPORT_TOKEN_ISSUED_KEY}`, issued.toISOString())

    const within = new Date(issued.getTime() + PERF_EXPORT_TOKEN_TTL_MS)
    const after = new Date(issued.getTime() + PERF_EXPORT_TOKEN_TTL_MS + 1)
    expect(await perfExportOwner(token, within)).toBe('tommie')
    expect(await perfExportOwner(token, after)).toBeNull()
  })

  test('発行時刻を持たない鍵 (古い発行) は切れた扱い', async () => {
    const token = await issuePerfExportToken('tommie')
    store.delete(`tommie\n${PERF_EXPORT_TOKEN_ISSUED_KEY}`)
    expect(await perfExportOwner(token)).toBeNull()
  })
})
