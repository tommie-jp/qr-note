// 健康記録を 1 つ書き込む (docs/83 §7・docs/123 §2-1)
import type { NextResponse } from 'next/server'
import { toItemDto } from '@/lib/api/itemDto'
import { guardItemRoute, type ItemRouteContext } from '@/lib/api/itemRoute'
import { runCommand } from '@/lib/api/runCommand'
import { recordHealth, type HealthRecord } from '@/lib/commands/noteCommands'
import { MAX_MEASURE_VALUES } from '@/lib/health/healthRecords'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'

// 文字列の欄の上限。日付・項目名・単位はどれも短い
const MAX_FIELD_LENGTH = 100

// 改行・制御文字・バッククォートは受けない。記録はフェンスの中の 1 行に
// 書かれるので、これらが入るとフェンスの形が崩れる
const UNSAFE_FIELD = /[\x00-\x1f\x7f`]/

function isShortString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_FIELD_LENGTH && !UNSAFE_FIELD.test(value)
}

export async function POST(request: Request, context: ItemRouteContext): Promise<NextResponse> {
  const guard = await guardItemRoute(request, context)
  if (!guard.ok) {
    return guard.response
  }
  const body = await parseJsonBody<HealthRecord>(request, ({ date, item, values, unit }) => {
    // 値は配列 (血圧のような対の値。docs/83 §9)。疎配列と数でないものを落とす
    if (
      !isShortString(date) ||
      !isShortString(item) ||
      !isShortString(unit) ||
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > MAX_MEASURE_VALUES ||
      values.filter((v) => typeof v === 'number' && Number.isFinite(v)).length !== values.length
    ) {
      return null
    }
    return { date, item, values: values as number[], unit }
  })
  if (!body.ok) {
    return body.response
  }
  const { itemId } = guard
  return runCommand('健康記録', async () => {
    const item = await recordHealth(itemId, body.value)
    return apiOk({ item: toItemDto(item) })
  })
}
