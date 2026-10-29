// ノートの git 履歴を書く (docs/57)。op で「版を刻む」「版に戻す」を撃ち分ける。
// デモでは履歴機能ごと閉じる
import { revalidatePath } from 'next/cache'
import type { NextResponse } from 'next/server'
import { toItemDto } from '@/lib/api/itemDto'
import { guardItemRoute, type ItemRouteContext } from '@/lib/api/itemRoute'
import { runCommand } from '@/lib/api/runCommand'
import { commitNoteVersion, restoreNoteVersion } from '@/lib/commands/historyCommands'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'
import { MAX_TEXT_LENGTH } from '@/lib/validation'

type HistoryBody = { op: 'commit'; message: string } | { op: 'restore'; oid: string }

export async function POST(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context, { demo: 'deny' })
  if (!guard.ok) {
    return guard.response
  }
  const body = await parseJsonBody<HistoryBody>(request, ({ op, message, oid }) => {
    if (op === 'commit') {
      const text = typeof message === 'string' ? message : ''
      return text.length > MAX_TEXT_LENGTH ? null : { op, message: text }
    }
    if (op === 'restore' && typeof oid === 'string') {
      return { op, oid }
    }
    return null
  })
  if (!body.ok) {
    return body.response
  }
  const { itemId } = guard
  const value = body.value
  return runCommand('履歴の操作', async () => {
    // 履歴の画面はサーバ描画のまま (docs/123 §4-3)。書いたら描き直させる
    revalidatePath(`/item/${itemId}/history`)
    if (value.op === 'commit') {
      return apiOk({ result: await commitNoteVersion(itemId, value.message) })
    }
    const item = await restoreNoteVersion(itemId, value.oid)
    revalidatePath(`/item/${itemId}`)
    return apiOk({ item: toItemDto(item) })
  })
}
