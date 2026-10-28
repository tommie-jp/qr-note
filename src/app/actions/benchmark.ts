'use server'

import os from 'node:os'
import { isAdminUser } from '@/lib/auth/admin'
import { requireUser } from '@/lib/auth/session'
import { errorText } from '@/lib/errorMessage'
import { formatBenchmark, runBenchmark } from '@/lib/diag/benchmark'
import { requireUserOutsideDemo } from './_guards'

export type BenchmarkActionResult =
  | { ok: true; text: string }
  | { ok: false; message: string }

// サーバー情報画面の「計測」釦。CPU を数十秒使い切るので管理者だけ
export async function runBenchmarkAction(): Promise<BenchmarkActionResult> {
  await requireUserOutsideDemo('デモモードでは計測できません')
  if (!isAdminUser(await requireUser())) {
    throw new Error('管理者だけが計測できます')
  }
  try {
    const r = await runBenchmark(os.cpus().length)
    return { ok: true, text: formatBenchmark(r) }
  } catch (error) {
    return { ok: false, message: errorText(error) }
  }
}
