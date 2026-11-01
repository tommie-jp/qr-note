// 全ノートの今の本文を履歴へ取り込む (docs/57 §5)。デモでは閉じる
import { revalidatePath } from 'next/cache'
import type { NextResponse } from 'next/server'
import { runCommand } from '@/lib/api/runCommand'
import { backfillHistory } from '@/lib/commands/historyCommands'
import { guardAdminRequest } from '@/lib/route/guard'
import { apiOk } from '@/lib/route/respond'

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardAdminRequest(request, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  return runCommand('履歴の取り込み', async () => {
    const result = await backfillHistory()
    revalidatePath('/settings/history')
    return apiOk({ result })
  })
}
