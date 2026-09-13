import 'server-only'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrlEnv, isNodeEnvProduction } from './appEnv'

function createPrismaClient(): PrismaClient {
  const connectionString = databaseUrlEnv()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

// Next.js の開発サーバはホットリロードごとにモジュールを再評価するため、
// グローバルに保持して接続の増殖を防ぐ
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (!isNodeEnvProduction()) {
  globalForPrisma.prisma = prisma
}
