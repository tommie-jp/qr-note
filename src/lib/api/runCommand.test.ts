import { afterEach, describe, expect, test, vi } from 'vitest'
import { CommandError } from '@/lib/commands/commandError'
import { apiOk } from '@/lib/route/respond'
import { INTERNAL_ERROR_MESSAGE, runCommand } from './runCommand'

// 書き込みの口の後ろ半分 (docs/123 §2-1)。利用者に見せてよい失敗だけを
// その状態コードで返し、それ以外は中身を漏らさず 500 の定型文に畳む
afterEach(() => {
  vi.restoreAllMocks()
})

describe('runCommand', () => {
  test('本体の応答をそのまま返す', async () => {
    // Arrange
    const ok = apiOk({ count: 1 })

    // Act
    const res = await runCommand('テスト', async () => ok)

    // Assert
    expect(res).toBe(ok)
  })

  test('CommandError はその状態コードと文言で返す', async () => {
    const res = await runCommand('テスト', async () => {
      throw new CommandError(409, '空き番号がありません')
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ success: false, data: null, error: '空き番号がありません' })
  })

  test('それ以外の例外は 500 の定型文にし、中身はログにだけ残す', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cause = new Error('connect ECONNREFUSED 10.0.0.3:5432')

    const res = await runCommand('ノートの保存', async () => {
      throw cause
    })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ success: false, data: null, error: INTERNAL_ERROR_MESSAGE })
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED')
    expect(error).toHaveBeenCalledWith('ノートの保存 に失敗しました', cause)
  })
})
