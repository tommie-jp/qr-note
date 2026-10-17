import { expect, test, vi } from 'vitest'
import { collectDbInfo, type DbClient } from './dbInfo'

// db.ts は読み込み時に DATABASE_URL を要求する。ここでは本物の接続は使わない
// (client / 収集を引数で差し替える) ので、モジュールごと空にする
vi.mock('@/lib/db', () => ({ prisma: {} }))

// $queryRaw はタグ付きテンプレートで呼ばれる。SQL 文の一部で見分けて答えを返す
type Answer = (sql: string) => unknown

function fakeClient(answer: Answer, counts = { item: 1234, image: 56 }): DbClient {
  const queryRaw = vi.fn(async (query: TemplateStringsArray) => answer(query.join('?')))
  return {
    $queryRaw: queryRaw,
    item: { count: async () => counts.item },
    image: { count: async () => counts.image },
  } as unknown as DbClient
}

const HEALTHY_ANSWER: Answer = (sql) => {
  if (sql.includes('SELECT 1')) return [{ one: 1 }]
  if (sql.includes('version()')) return [{ version: 'PostgreSQL 18.1 on x86_64-pc-linux-musl' }]
  if (sql.includes('pg_extension')) return [{ extversion: '4.1.0' }]
  if (sql.includes('pg_indexes')) return [{ indexname: 'items_memo_pgroonga_idx' }, { indexname: 'items_title_pgroonga_idx' }]
  if (sql.includes('pg_database_size')) return [{ bytes: BigInt(734003200) }]
  if (sql.includes('pg_postmaster_start_time')) return [{ started: new Date('2026-10-10T00:00:00Z') }]
  if (sql.includes('pg_stat_activity')) return [{ n: 3 }]
  if (sql.includes('max_connections')) return [{ setting: '100' }]
  if (sql.includes('pg_total_relation_size')) {
    return [
      { relname: 'images', bytes: BigInt(700000000) },
      { relname: 'items', bytes: BigInt(30000000) },
    ]
  }
  if (sql.includes('_prisma_migrations') && sql.includes('count')) return [{ n: 0 }]
  if (sql.includes('_prisma_migrations')) {
    return [{ migration_name: '20261017_item_uuid', finished_at: new Date('2026-10-17T00:00:00Z') }]
  }
  throw new Error(`unexpected sql: ${sql}`)
}

function rowValue(rows: { label: string; value: string }[], label: string) {
  const row = rows.find((r) => r.label === label)
  if (!row) {
    throw new Error(`row not found: ${label}`)
  }
  return row.value
}

test('版・PGroonga・大きさ・接続・表・件数・最新マイグレーションを並べる', async () => {
  // Act
  const info = await collectDbInfo(fakeClient(HEALTHY_ANSWER))
  const rows = info.section.result.kind === 'ok' ? info.section.result.rows : []

  // Assert
  expect(rowValue(rows, 'PostgreSQL')).toBe('PostgreSQL 18.1 on x86_64-pc-linux-musl')
  expect(rowValue(rows, 'PGroonga')).toBe('4.1.0')
  expect(rowValue(rows, 'PGroonga 索引')).toBe('items_memo_pgroonga_idx, items_title_pgroonga_idx')
  expect(rowValue(rows, 'DB の大きさ')).toBe('700.0 MB')
  expect(rowValue(rows, 'DB の起動')).toBe('2026/10/10 09:00:00')
  expect(rowValue(rows, '接続数')).toBe('3 / 100')
  expect(rowValue(rows, '表の大きさ')).toBe('images 667.6 MB, items 28.6 MB')
  expect(rowValue(rows, 'ノート')).toBe('1234 件')
  expect(rowValue(rows, '画像・動画')).toBe('56 件')
  expect(rowValue(rows, '最新マイグレーション')).toBe('20261017_item_uuid (2026/10/17 09:00:00)')
})

test('ヘルスチェックの入力 (応答時間・PGroonga・索引・壊れたマイグレーション) を返す', async () => {
  // Act
  const info = await collectDbInfo(fakeClient(HEALTHY_ANSWER))

  // Assert
  expect(info.health.kind).toBe('ok')
  if (info.health.kind === 'ok') {
    expect(info.health.pingMs).toBeGreaterThanOrEqual(0)
    expect(info.health.pgroongaVersion).toBe('4.1.0')
    expect(info.health.pgroongaIndexes).toEqual(['items_memo_pgroonga_idx', 'items_title_pgroonga_idx'])
    expect(info.health.brokenMigrations).toBe(0)
  }
})

test('PGroonga が無ければ版は「無し」で、入力は null / 空', async () => {
  // Arrange
  const answer: Answer = (sql) => {
    if (sql.includes('pg_extension')) return []
    if (sql.includes('pg_indexes')) return []
    return HEALTHY_ANSWER(sql)
  }

  // Act
  const info = await collectDbInfo(fakeClient(answer))
  const rows = info.section.result.kind === 'ok' ? info.section.result.rows : []

  // Assert
  expect(rowValue(rows, 'PGroonga')).toBe('無し')
  expect(rowValue(rows, 'PGroonga 索引')).toBe('無し')
  expect(info.health.kind === 'ok' && info.health.pgroongaVersion).toBeNull()
  expect(info.health.kind === 'ok' && info.health.pgroongaIndexes).toEqual([])
})

test('DB に届かなければ節は失敗、ヘルスの入力も失敗で理由を運ぶ', async () => {
  // Arrange
  const client = fakeClient(() => {
    throw new Error("connect ECONNREFUSED 10.0.0.2:5432")
  })

  // Act
  const info = await collectDbInfo(client)

  // Assert
  expect(info.section.result).toEqual({
    kind: 'failed',
    message: 'connect ECONNREFUSED 10.0.0.2:5432',
  })
  expect(info.health).toEqual({ kind: 'failed', message: 'connect ECONNREFUSED 10.0.0.2:5432' })
})

test('マイグレーションの表が無い (まだ 1 本も当てていない) ときは「無し」で、健全とはみなさない', async () => {
  // Arrange
  const answer: Answer = (sql) => {
    if (sql.includes('_prisma_migrations')) {
      throw new Error('relation "_prisma_migrations" does not exist')
    }
    return HEALTHY_ANSWER(sql)
  }

  // Act
  const info = await collectDbInfo(fakeClient(answer))

  // Assert
  expect(info.section.result.kind).toBe('failed')
  expect(info.health.kind).toBe('failed')
})
