// 「このまま上書き」で消える版を、履歴へ 1 版だけ残す (docs/87 §4)。
// もとは app/actions/_save.ts。刻めなければ false を返し、呼び手は上書きしない
import 'server-only'
import { isDemoMode } from '@/lib/appEnv'
import { commitNote } from '@/lib/git/notesRepo'
import { getItem } from '@/lib/items/read'

export async function checkpointBeforeOverwrite(itemId: string, incoming: string): Promise<boolean> {
  // デモは履歴機能ごと閉じている (docs/57 §4)。刻めないのが正常なので通す
  if (isDemoMode()) {
    return true
  }
  const current = await getItem(itemId)
  if (current === null || current.memo === incoming) {
    return true
  }
  try {
    await commitNote(itemId, current.memo, `conflict ${itemId}`)
    return true
  } catch (error) {
    console.error(`競合チェックポイントのコミットに失敗しました (${itemId})`, error)
    return false
  }
}
