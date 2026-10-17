import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AppInfo } from './appInfo'
import type { DbInfo } from './dbInfo'
import type { HostInfo } from './hostInfo'
import { collectServerInfo, SECTION_TIMEOUT_MS, type ServerInfoCollectors } from './serverInfo'

// db.ts は読み込み時に DATABASE_URL を要求する。ここでは本物の接続は使わない
// (client / 収集を引数で差し替える) ので、モジュールごと空にする
vi.mock('@/lib/db', () => ({ prisma: {} }))

const GB = 1024 ** 3

const HOST: HostInfo = {
  sections: [
    { id: 'host', title: 'ホスト', result: { kind: 'ok', rows: [{ label: 'OS', value: 'Ubuntu' }] } },
    { id: 'container', title: 'コンテナ', result: { kind: 'ok', rows: [] } },
  ],
  memory: { totalBytes: 2 * GB, availableBytes: GB, swapTotalBytes: 0, swapFreeBytes: 0 },
}

const APP: AppInfo = {
  section: { id: 'app', title: 'QR-Note', result: { kind: 'ok', rows: [{ label: '版', value: '0.1' }] } },
  disk: { totalBytes: 10 * GB, freeBytes: 5 * GB },
  gitRepo: { kind: 'ok' },
  errorLogCount: 0,
  rakutenSet: 3,
  webauthnSet: 2,
}

const DB: DbInfo = {
  section: { id: 'db', title: 'DB', result: { kind: 'ok', rows: [{ label: 'PostgreSQL', value: '18' }] } },
  health: { kind: 'ok', pingMs: 5, pgroongaVersion: '4.1.0', pgroongaIndexes: ['idx'], brokenMigrations: 0 },
}

function collectors(overrides: Partial<ServerInfoCollectors> = {}): ServerInfoCollectors {
  return {
    host: async () => HOST,
    app: async () => APP,
    db: async () => DB,
    now: () => new Date('2026-10-17T03:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test('節は ホスト → コンテナ → QR-Note → DB の順で、判定は全部 OK', async () => {
  // Act
  const info = await collectServerInfo(collectors())

  // Assert
  expect(info.sections.map((s) => s.id)).toEqual(['host', 'container', 'app', 'db'])
  expect(info.overall).toBe('ok')
  expect(info.collectedAt.toISOString()).toBe('2026-10-17T03:00:00.000Z')
})

test('1 つの収集が投げても他の節は出し、その節は失敗として理由を持ち、サーバログに warn を残す', async () => {
  // Arrange
  const deps = collectors({
    db: async () => {
      throw new Error('boom')
    },
  })

  // Act
  const info = await collectServerInfo(deps)

  // Assert
  const db = info.sections.find((s) => s.id === 'db')!
  expect(db.result).toEqual({ kind: 'failed', message: 'boom' })
  expect(info.sections.find((s) => s.id === 'host')!.result.kind).toBe('ok')
  // DB 由来のヘルスは異常 → 全体も異常
  expect(info.overall).toBe('error')
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('DB'), expect.any(Error))
})

test('収集が期限を過ぎたら切り上げて失敗にする', async () => {
  // Arrange
  vi.useFakeTimers()
  const deps = collectors({ host: () => new Promise(() => {}) })

  // Act
  const pending = collectServerInfo(deps)
  await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS)
  const info = await pending

  // Assert
  const host = info.sections.find((s) => s.id === 'host')!
  expect(host.result.kind).toBe('failed')
  expect(host.result.kind === 'failed' && host.result.message).toContain(`${SECTION_TIMEOUT_MS}ms`)
  // ホストの節が無いので、ホストとコンテナの枠は失敗として並ぶ (枠ごと消さない)
  expect(info.sections.map((s) => s.id)).toEqual(['host', 'container', 'app', 'db'])
  // メモリが読めないのでヘルスは注意
  expect(info.overall).toBe('warn')
})
