import { expect, test } from 'vitest'
import { type AppProbe, collectAppInfo } from './appInfo'

const GB = 1024 ** 3

function probe(overrides: Partial<AppProbe> = {}): AppProbe {
  return {
    version: '0.23.34',
    nodeVersion: 'v24.1.0',
    nextVersion: '16.2.11',
    prismaVersion: '7.9.1',
    appEnv: 'production',
    isDemo: false,
    processUptimeSeconds: 3600 * 5 + 60 * 7,
    now: () => new Date('2026-10-17T12:00:00+09:00'),
    memoryUsage: () => ({ rss: 300 * 1024 * 1024, heapUsed: 80 * 1024 * 1024, heapTotal: 120 * 1024 * 1024 }),
    timeZone: 'Asia/Tokyo',
    dataDir: '/app/data/git-notes',
    statfs: async () => ({ totalBytes: 40 * GB, freeBytes: 20 * GB }),
    gitRepoState: async () => 'ready' as const,
    hasYahoo: true,
    rakutenSet: 3,
    webauthnSet: 2,
    errorLogCount: 0,
    ...overrides,
  }
}

function rowValue(rows: { label: string; value: string }[], label: string) {
  const row = rows.find((r) => r.label === label)
  if (!row) {
    throw new Error(`row not found: ${label}`)
  }
  return row.value
}

test('版・ランタイム・起動時刻・メモリ・外部連携のあり/なしを並べる', async () => {
  // Act
  const info = await collectAppInfo(probe())
  const rows = info.section.result.kind === 'ok' ? info.section.result.rows : []

  // Assert
  expect(rowValue(rows, '版')).toBe('0.23.34')
  expect(rowValue(rows, 'Node.js')).toBe('v24.1.0')
  expect(rowValue(rows, 'Next.js')).toBe('16.2.11')
  expect(rowValue(rows, 'Prisma')).toBe('7.9.1')
  expect(rowValue(rows, 'APP_ENV')).toBe('production')
  expect(rowValue(rows, 'デモモード')).toBe('いいえ')
  expect(rowValue(rows, '起動')).toBe('2026/10/17 06:53:00 (5 時間 7 分 前)')
  expect(rowValue(rows, 'プロセスのメモリ')).toBe('RSS 300.0 MB / ヒープ 80.0 MB (確保 120.0 MB)')
  expect(rowValue(rows, 'タイムゾーン')).toBe('Asia/Tokyo')
  expect(rowValue(rows, 'データ領域')).toBe('/app/data/git-notes — 空き 20.0 GB / 40.0 GB (50%)')
  expect(rowValue(rows, 'Yahoo!ショッピング')).toBe('設定あり')
  expect(rowValue(rows, '楽天ブックス')).toBe('設定あり (3/3)')
  expect(rowValue(rows, 'パスキー')).toBe('設定あり (2/2)')
})

test('env の値そのものは出さない (あり/なしだけ)', async () => {
  // Act
  const info = await collectAppInfo(probe({ hasYahoo: false, rakutenSet: 1, webauthnSet: 0 }))
  const rows = info.section.result.kind === 'ok' ? info.section.result.rows : []

  // Assert
  expect(rowValue(rows, 'Yahoo!ショッピング')).toBe('未設定')
  expect(rowValue(rows, '楽天ブックス')).toBe('一部だけ (1/3)')
  expect(rowValue(rows, 'パスキー')).toBe('未設定')
  expect(JSON.stringify(rows)).not.toContain('pk_')
})

test('APP_ENV が未設定なら「(未設定)」と出す', async () => {
  const info = await collectAppInfo(probe({ appEnv: undefined, isDemo: true }))
  const rows = info.section.result.kind === 'ok' ? info.section.result.rows : []
  expect(rowValue(rows, 'APP_ENV')).toBe('(未設定)')
  expect(rowValue(rows, 'デモモード')).toBe('はい')
})

test('ヘルスチェックの入力 (ディスク・git・件数) を一緒に返す', async () => {
  // Act
  const info = await collectAppInfo(probe({ errorLogCount: 2 }))

  // Assert
  expect(info.disk).toEqual({ totalBytes: 40 * GB, freeBytes: 20 * GB })
  expect(info.gitRepo).toEqual({ kind: 'ok' })
  expect(info.errorLogCount).toBe(2)
  expect(info.rakutenSet).toBe(3)
  expect(info.webauthnSet).toBe(2)
})

test('statfs や git の HEAD が失敗しても節は出し、入力に理由を残す', async () => {
  // Act
  const info = await collectAppInfo(
    probe({
      statfs: async () => {
        throw new Error('ENOENT: statfs')
      },
      gitRepoState: async () => {
        throw new Error('ENOENT: HEAD')
      },
    }),
  )
  const rows = info.section.result.kind === 'ok' ? info.section.result.rows : []

  // Assert
  expect(info.disk).toBeNull()
  expect(info.gitRepo).toEqual({ kind: 'failed', message: 'ENOENT: HEAD' })
  expect(rowValue(rows, 'データ領域')).toContain('不明')
  expect(rowValue(rows, 'データ領域')).toContain('ENOENT: statfs')
})

test('git の置き場がまだ無ければ未初期化として返す (失敗ではない)', async () => {
  // Act
  const info = await collectAppInfo(probe({ gitRepoState: async () => 'uninitialized' }))

  // Assert
  expect(info.gitRepo).toEqual({ kind: 'uninitialized' })
})
