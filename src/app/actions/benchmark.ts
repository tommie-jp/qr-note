'use server'

import os from 'node:os'
import { cookies } from 'next/headers'
import { isAdminUser } from '@/lib/auth/admin'
import { requireUser } from '@/lib/auth/session'
import { startBenchmark } from '@/lib/diag/benchmark'
import { startJob } from '@/lib/diag/benchJob'
import { type BenchStatus, loadBenchStatus } from '@/lib/diag/benchStatus'
import { pageBenchCookie, runServerBench } from '@/lib/diag/serverBench'
import { isPerfLogEnabled } from '@/lib/logging/perfSwitch'
import { requireUserOutsideDemo } from './_guards'

// QR-Note ベンチマーク (docs/121-QR-Noteベンチマーク計画.md)。
// どれも CPU を使い切るので管理者だけ。始めたら直ちに返し、終わりは
// getBenchStatusAction を引いて待つ (nginx の応答待ち 60 秒に当てない)
async function requireAdmin(): Promise<void> {
  await requireUserOutsideDemo('デモモードでは計測できません')
  if (!isAdminUser(await requireUser())) {
    throw new Error('管理者だけが計測できます')
  }
}

// 計測テスト (docs/120) が立っている間はサーバを測らない。端末の操作が
// 同じ CPU を取り合い、どちらの数字も嘘になる
function refuseWhilePerfTest(): void {
  if (isPerfLogEnabled()) {
    throw new Error('速度計測 (計測テスト) が動いています。終わってから押してください')
  }
}

export async function startCpuBenchAction(): Promise<BenchStatus> {
  await requireAdmin()
  refuseWhilePerfTest()
  startBenchmark(os.cpus().length)
  return loadBenchStatus()
}

export async function startServerBenchAction(): Promise<BenchStatus> {
  await requireAdmin()
  refuseWhilePerfTest()
  // 検索ページの組み立て (page:search) は押した管理者の cookie で自分自身を叩く
  const pageCookie = pageBenchCookie((await cookies()).getAll())
  startJob('server', async () => {
    await runServerBench({ pageCookie })
  })
  return loadBenchStatus()
}

export async function getBenchStatusAction(): Promise<BenchStatus> {
  await requireAdmin()
  return loadBenchStatus()
}
