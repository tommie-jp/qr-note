// DB の節 (docs/109-サーバー情報計画.md §3)。
//
// PostgreSQL と PGroonga の版、DB の大きさ、接続数、表の大きさ、ノートと
// 画像の件数、適用済みの最新マイグレーション。PGroonga の索引の名前も出す —
// prisma migrate や createdb -T で**静かに消える**ことが 2 度あり、消えても
// seq scan で動くので気づけない (docs/109 §1)。ここで名前が並べば一目で分かる。
//
// SQL は全部タグ付きテンプレート ($queryRaw`...`) で、値の埋め込みは無い。
// どの 1 本が失敗しても節ごと「取得できませんでした」にし、ヘルスの入力も
// 失敗として運ぶ — 一部だけ取れた値で OK を出すと、一番見たいときに嘘になる。
//
// client はテストから差し替える (本物は db.ts の prisma)
import 'server-only'
import type { PrismaClient } from '@/generated/prisma/client'
import { prisma } from '../db'
import { formatJstDateTime } from '../datetime'
import { safeErrorText } from './safeErrorText'
import { formatBytes } from '../formatBytes'
import type { DbHealth } from './healthChecks'
import type { InfoRow, InfoSection } from './types'

export type DbClient = Pick<PrismaClient, '$queryRaw'> & {
  item: Pick<PrismaClient['item'], 'count'>
  image: Pick<PrismaClient['image'], 'count'>
}

export interface DbInfo {
  section: InfoSection
  health: DbHealth
}

// 表の大きさは上位だけ。全部並べても images と items 以外はごみ
const TOP_TABLE_COUNT = 6

interface Snapshot {
  pingMs: number
  version: string
  pgroongaVersion: string | null
  pgroongaIndexes: string[]
  databaseBytes: bigint
  startedAt: Date
  connections: number
  maxConnections: string
  tables: { relname: string; bytes: bigint }[]
  itemCount: number
  imageCount: number
  latestMigration: { migration_name: string; finished_at: Date | null } | null
  brokenMigrations: number
}

// 1 行 1 列の答えを取る。行が無ければ null
function first<T>(rows: T[]): T | null {
  return rows.length > 0 ? rows[0] : null
}

async function snapshot(client: DbClient): Promise<Snapshot> {
  const pingStart = performance.now()
  await client.$queryRaw<{ one: number }[]>`SELECT 1 AS one`
  const pingMs = Math.round(performance.now() - pingStart)

  const [
    version,
    pgroonga,
    indexes,
    size,
    started,
    activity,
    maxConn,
    tables,
    itemCount,
    imageCount,
    latest,
    broken,
  ] = await Promise.all([
    client.$queryRaw<{ version: string }[]>`SELECT version() AS version`,
    client.$queryRaw<{ extversion: string }[]>`SELECT extversion FROM pg_extension WHERE extname = 'pgroonga'`,
    client.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexdef ILIKE '%pgroonga%' ORDER BY indexname`,
    client.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`,
    client.$queryRaw<{ started: Date }[]>`SELECT pg_postmaster_start_time() AS started`,
    client.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`,
    client.$queryRaw<{ setting: string }[]>`SELECT setting FROM pg_settings WHERE name = 'max_connections'`,
    client.$queryRaw<{ relname: string; bytes: bigint }[]>`SELECT c.relname, pg_total_relation_size(c.oid) AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY bytes DESC LIMIT ${TOP_TABLE_COUNT}`,
    client.item.count(),
    client.image.count(),
    client.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS FIRST LIMIT 1`,
    client.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`,
  ])

  return {
    pingMs,
    version: first(version)?.version ?? '不明',
    pgroongaVersion: first(pgroonga)?.extversion ?? null,
    pgroongaIndexes: indexes.map((r) => r.indexname),
    databaseBytes: first(size)?.bytes ?? BigInt(0),
    startedAt: first(started)?.started ?? new Date(0),
    connections: first(activity)?.n ?? 0,
    maxConnections: first(maxConn)?.setting ?? '?',
    tables,
    itemCount,
    imageCount,
    latestMigration: first(latest),
    brokenMigrations: first(broken)?.n ?? 0,
  }
}

function migrationLabel(latest: Snapshot['latestMigration']): string {
  if (latest === null) {
    return '無し'
  }
  const when = latest.finished_at === null ? '未完' : formatJstDateTime(latest.finished_at)
  return `${latest.migration_name} (${when})`
}

function rowsOf(s: Snapshot): InfoRow[] {
  return [
    { label: 'PostgreSQL', value: s.version },
    { label: 'PGroonga', value: s.pgroongaVersion ?? '無し' },
    { label: 'PGroonga 索引', value: s.pgroongaIndexes.length === 0 ? '無し' : s.pgroongaIndexes.join(', ') },
    { label: 'DB の大きさ', value: formatBytes(s.databaseBytes) },
    { label: 'DB の起動', value: formatJstDateTime(s.startedAt) },
    { label: '接続数', value: `${s.connections} / ${s.maxConnections}` },
    {
      label: '表の大きさ',
      value: s.tables.map((t) => `${t.relname} ${formatBytes(t.bytes)}`).join(', '),
    },
    { label: 'ノート', value: `${s.itemCount} 件` },
    { label: '画像・動画', value: `${s.imageCount} 件` },
    { label: '最新マイグレーション', value: migrationLabel(s.latestMigration) },
  ]
}

export async function collectDbInfo(client: DbClient = prisma): Promise<DbInfo> {
  try {
    const s = await snapshot(client)
    return {
      section: { id: 'db', title: 'DB', result: { kind: 'ok', rows: rowsOf(s) } },
      health: {
        kind: 'ok',
        pingMs: s.pingMs,
        pgroongaVersion: s.pgroongaVersion,
        pgroongaIndexes: s.pgroongaIndexes,
        brokenMigrations: s.brokenMigrations,
      },
    }
  } catch (error) {
    const message = safeErrorText(error)
    return {
      section: { id: 'db', title: 'DB', result: { kind: 'failed', message } },
      health: { kind: 'failed', message },
    }
  }
}
