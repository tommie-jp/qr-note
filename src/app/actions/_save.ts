import { isDemoMode } from '@/lib/appEnv'
import { commitNote } from '@/lib/git/notesRepo'
import { getItem } from '@/lib/items/read'

// 本文を書き換える保存経路 (items.ts の保存と history.ts の復元) が共有する部品。
// 'use server' を付けない理由は _guards.ts と同じ (付けると外から呼べる口になる)

// 「このまま上書き」で消える版を、履歴へ 1 版だけ残す (docs/87 §4)。
//
// **保存のたびには刻まない** (docs/57 §8 の判断)。刻むのは競合を見せたうえで
// 利用者が上書きを選んだときだけで、稀・かつ意味のある版になる。
//
// after() は使わず await する。after() は redirect でもエラーでも走るうえ、
// notesRepo のキューは reject を先に処理済みにするので失敗が見えない。
//
// **刻めなければ false を返し、呼び手は上書きしない** (fail closed)。
// 「保存が git の失敗に巻き込まれてはいけない」(docs/57 §1) は普段の保存の
// 原則で、ここは利用者が「消してよい」と選んだ経路。消える版を残せないなら
// 消さないほうが約束に合う
export async function checkpointBeforeOverwrite(
  itemNo: string,
  incoming: string,
): Promise<boolean> {
  // デモは履歴機能ごと閉じている (docs/57 §4)。刻めないのが正常なので通す
  if (isDemoMode()) {
    return true
  }
  const current = await getItem(itemNo)
  if (current === null || current.memo === incoming) {
    return true
  }
  try {
    // HEAD と同じ内容なら commitNote は null を返すだけ (履歴は汚れない)
    await commitNote(itemNo, current.memo, `conflict ${itemNo}`)
    return true
  } catch (error) {
    console.error(`競合チェックポイントのコミットに失敗しました (${itemNo})`, error)
    return false
  }
}

// 保存後の「保存しました」トースト用の戻り先 (docs/11-アプリ的UIUX計画.md §2-3)。
// 値を時刻にするのは、連続保存でも毎回トーストを出すため (SavedToast の key に
// 使う)。印はトーストを出した直後にクライアントが URL から消す
export function savedHref(itemNo: string): string {
  return `/item/${itemNo}?saved=${Date.now()}`
}
