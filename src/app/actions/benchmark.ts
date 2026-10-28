'use server'

import os from 'node:os'
import { isAdminUser } from '@/lib/auth/admin'
import { requireUser } from '@/lib/auth/session'
import {
  benchmarkProgress,
  formatBenchmark,
  readSavedBenchmark,
  startBenchmark,
} from '@/lib/diag/benchmark'
import { safeErrorText } from '@/lib/diag/safeErrorText'
import { requireUserOutsideDemo } from './_guards'

export type BenchmarkStatus = {
  running: boolean
  // 保存済みの結果 (整形済み)。未計測は null
  saved: string | null
  // 直近の計測の失敗理由。読み出しの失敗もここに入る
  error: string | null
}

// CPU を 1 分前後使い切るので管理者だけ
async function requireAdmin(): Promise<void> {
  await requireUserOutsideDemo('デモモードでは計測できません')
  if (!isAdminUser(await requireUser())) {
    throw new Error('管理者だけが計測できます')
  }
}

async function currentStatus(): Promise<BenchmarkStatus> {
  const { running, error } = benchmarkProgress()
  try {
    const saved = await readSavedBenchmark()
    return { running, saved: saved && formatBenchmark(saved), error }
  } catch (readError) {
    return { running, saved: null, error: error ?? safeErrorText(readError) }
  }
}

// 計測を始めて直ちに返す。終わりは getBenchmarkStatusAction で待つ
export async function startBenchmarkAction(): Promise<BenchmarkStatus> {
  await requireAdmin()
  startBenchmark(os.cpus().length)
  return currentStatus()
}

export async function getBenchmarkStatusAction(): Promise<BenchmarkStatus> {
  await requireAdmin()
  return currentStatus()
}
