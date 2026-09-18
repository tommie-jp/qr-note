import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// user_settings (DB) は偽物にする。確かめたいのは「誰に・何を返すか」の畳み方
const stored = new Map<string, string>()
const reads: string[] = []

vi.mock('@/lib/prefs/userSettingStore', () => ({
  readUserSetting: async (user: string, key: string) => {
    reads.push(`${user}:${key}`)
    return stored.get(`${user}:${key}`) ?? null
  },
  writeUserSetting: async (user: string, key: string, value: string) => {
    stored.set(`${user}:${key}`, value)
  },
}))

const { loadPhotoMetaMode, savePhotoMetaMode } = await import('./photoMetaStore')

beforeEach(() => {
  stored.clear()
  reads.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test('保存した値を利用者ごとに返す', async () => {
  await savePhotoMetaMode('tommie', 'keep')

  expect(await loadPhotoMetaMode('tommie')).toBe('keep')
  expect(await loadPhotoMetaMode('other')).toBe('strip')
})

test('未設定・壊れた値は「消す」', async () => {
  expect(await loadPhotoMetaMode('tommie')).toBe('strip')

  stored.set('tommie:photo-meta', 'maybe')

  expect(await loadPhotoMetaMode('tommie')).toBe('strip')
})

test('未ログインは DB を引かずに「消す」', async () => {
  expect(await loadPhotoMetaMode(null)).toBe('strip')
  expect(reads).toEqual([])
})

// デモは共有アカウント。誰かが「残す」にしても全員の写真に効いてしまう
test('デモでは保存済みの値に関わらず「消す」', async () => {
  stored.set('guest:photo-meta', 'keep')
  vi.stubEnv('DEMO_MODE', '1')

  expect(await loadPhotoMetaMode('guest')).toBe('strip')
  expect(reads).toEqual([])
})
