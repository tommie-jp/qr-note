import 'server-only'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrlEnv, isNodeEnvProduction, perfLogEnv } from './appEnv'
import { reportSlowQuery } from './logging/perfServer'

function createPrismaClient(): PrismaClient {
  const connectionString = databaseUrlEnv()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  const adapter = new PrismaPg({ connectionString })
  // 遅い SQL の計測 (docs/119 §2-4) は**起動時に PERF_LOG=1 のときだけ**仕掛ける。
  // Prisma のログ設定は作った後に変えられず、query イベントを付けると計測して
  // いない間も全クエリでパラメータ (本文の 5MB を含みうる) を文字列化する。
  // /logs からの切替 (perfSwitch.ts) で止めた後は reportSlowQuery が黙る
  if (perfLogEnv() !== '1') {
    return new PrismaClient({ adapter })
  }
  const client = new PrismaClient({
    adapter,
    log: [{ emit: 'event', level: 'query' }],
  })
  client.$on('query', reportSlowQuery)
  return client as unknown as PrismaClient
}

// Next.js の開発サーバはホットリロードごとにモジュールを再評価するため、
// グローバルに保持して接続の増殖を防ぐ
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (!isNodeEnvProduction()) {
  globalForPrisma.prisma = prisma
}
