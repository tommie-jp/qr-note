// 書き込みの口の後ろ半分 (docs/123 §2-1)。本体を走らせ、利用者に見せてよい
// 失敗 (CommandError) はその状態コードで、それ以外は 500 の定型文で返す。
// 内部の例外の中身はサーバのログにだけ残す
import 'server-only'
import type { NextResponse } from 'next/server'
import { CommandError } from '@/lib/commands/commandError'
import { apiFail } from '@/lib/route/respond'

export const INTERNAL_ERROR_MESSAGE = 'サーバで処理できませんでした。時間をおいてもう一度お試しください'

export async function runCommand(
  label: string,
  run: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof CommandError) {
      return apiFail(error.message, error.status)
    }
    console.error(`${label} に失敗しました`, error)
    return apiFail(INTERNAL_ERROR_MESSAGE, 500)
  }
}
