import 'server-only'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrlEnv, isNodeEnvProduction, perfLogEnv } from './appEnv'
import { reportSlowQuery } from './logging/perfServer'

const POOL_IDLE_TIMEOUT_MS = 30 * 60 * 1000

function createPrismaClient(): PrismaClient {
  const connectionString = databaseUrlEnv()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  // 接続を閉じるまでの待ち時間 (docs/118 §0-13)。pg の既定は 10 秒で、
  // 画面を開き直す間が空くたびに全接続が閉じ、次の読み込みの冒頭で走る数本の
  // 問い合わせ (セッション・タグ・件数…) がそれぞれ新規接続を待っていた。
  // 手元で 0.7ms の問い合わせが 15ms、本番 (3 コア) では 230ms 前後。
  // 30 分なら使っている間は温かく、夜は閉じて VPS のメモリを返す
  const adapter = new PrismaPg({ connectionString, idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS })
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
