// ノート 1 件の口 (docs/123 §1-3)。未登録の id は 200 で item: null
// (QR シールを先に貼っておけるよう、未登録でも画面は開く)
import type { NextResponse } from 'next/server'
import { toItemDto } from '@/lib/api/itemDto'
import { guardItemRoute, type ItemRouteContext } from '@/lib/api/itemRoute'
import { getItem } from '@/lib/items/read'
import { runCommand } from '@/lib/api/runCommand'
import { saveNote } from '@/lib/commands/noteCommands'
import { parseBase, type SaveBase } from '@/lib/editor/saveBase'
import { parseJsonBody } from '@/lib/route/parse'
import { apiFailWith, apiOk } from '@/lib/route/respond'
import { MAX_TEXT_LENGTH } from '@/lib/validation'

export async function GET(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context)
  if (!guard.ok) {
    return guard.response
  }
  const item = await getItem(guard.itemId)
  return apiOk({ item: item === null ? null : toItemDto(item) })
}

interface SaveBody {
  memo: string
  base: SaveBase
  checkpoint: boolean
}

// 本文の保存 (docs/123 §2-2)。base (画面が見ていた版) は必須 — 落とすと
// 黙って上書きになる。食い違えば 409 と「いまのサーバの版」を返す
export async function PUT(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context)
  if (!guard.ok) {
    return guard.response
  }
  const body = await parseJsonBody<SaveBody>(request, (raw) => {
    const base = parseBase(raw.base)
    if (typeof raw.memo !== 'string' || raw.memo.length > MAX_TEXT_LENGTH || base === null) {
      return null
    }
    return { memo: raw.memo, base, checkpoint: raw.checkpoint === true }
  })
  if (!body.ok) {
    return body.response
  }
  const { itemId } = guard
  return runCommand('ノートの保存', async () => {
    const { memo, base, checkpoint } = body.value
    const result = await saveNote(itemId, memo, base, checkpoint)
    if (!result.ok) {
      return apiFailWith('ほかの画面で書き換えられています', 409, { state: result.state })
    }
    return apiOk({ item: toItemDto(result.item) })
  })
}
